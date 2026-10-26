import { openDb, migrate, query, getMeta } from './db.js';
import * as repo from './repo.js';
import { documentTotals, formatMoney, toPence, addDays, localToday, deriveStatus } from './money.js';
import { resizeImage } from './image.js';
import { buildPdf, sharePdf } from './pdf.js';
import { shareFile } from './share.js';
import { startSync, syncNow } from './sync.js';
import { isLoggedIn, login, register, logout, deleteAccount } from './api.js';

const view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setTitle = (t) => { document.getElementById('screen-title').textContent = t; };
const go = (hash) => { if (location.hash === hash) router(); else location.hash = hash; };
const chip = (doc) => { const s = deriveStatus(doc); return `<span class="chip chip-${s}">${s.replace('-', ' ')}</span>`; };
const PAYMENT_METHODS = ['cash', 'card', 'bank-transfer', 'other'];

function toast(msg) {
  const el = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(el);
  setTimeout(() => el.remove(), 2500);
}
function showError(e) {
  console.error(e);
  toast(e?.message || (e?.code ? `File error ${e.code}` : 'Something went wrong'));
}
function showFormError(form, errors) {
  const el = form.querySelector('#form-error');
  el.innerHTML = errors.map(esc).join('<br>');
  el.hidden = false;
}
const textFields = (fd, keys) => Object.fromEntries(keys.map((k) => [k, String(fd.get(k) || '').trim()]));

const routes = {
  '/onboarding': () => renderSettings(true),
  '/dashboard': renderDashboard,
  '/documents': (p) => renderDocumentList(p.get('filter') || 'all'),
  '/documents/new': (p) => renderEditor(null, p.get('type') || 'invoice'),
  '/documents/edit': (p) => renderEditor(p.get('id')),
  '/customers': renderCustomers,
  '/customers/new': (p) => renderCustomerForm(null, p.get('return')),
  '/customers/edit': (p) => renderCustomerForm(p.get('id')),
  '/items': renderItems,
  '/items/new': () => renderItemForm(null),
  '/items/edit': (p) => renderItemForm(p.get('id')),
  '/settings': () => renderSettings(false),
  '/login': renderLogin,
  '/conflicts': renderConflicts,
};

async function router() {
  const [path, qs] = (location.hash.slice(1) || '/dashboard').split('?');
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', path.startsWith(a.hash.slice(1))));
  try {
    await (routes[path] || renderDashboard)(new URLSearchParams(qs));
  } catch (e) {
    showError(e);
  }
}

// ---------- Dashboard ----------
async function renderDashboard() {
  setTitle('Home');
  const today = localToday();
  const [s] = await query(`SELECT
      COALESCE(SUM(total_pence - paid_pence), 0) AS outstanding,
      COALESCE(SUM(CASE WHEN due_date < ? THEN total_pence - paid_pence END), 0) AS overdue,
      COUNT(CASE WHEN due_date < ? THEN 1 END) AS overdue_count
    FROM documents WHERE deleted_at IS NULL AND type = 'invoice' AND status = 'issued' AND paid_pence < total_pence`, [today, today]);
  const [m] = await query(`SELECT COALESCE(SUM(paid_pence), 0) AS paid FROM documents
    WHERE deleted_at IS NULL AND status = 'issued' AND issue_date >= ?`, [`${today.slice(0, 7)}-01`]);
  const recent = await repo.list('document', { limit: 5 });
  view.innerHTML = `
    <div class="stats">
      <a class="card stat" href="#/documents?filter=unpaid">Outstanding<strong>${formatMoney(s.outstanding)}</strong></a>
      <a class="card stat" href="#/documents?filter=overdue">Overdue (${s.overdue_count})<strong class="error">${formatMoney(s.overdue)}</strong></a>
    </div>
    <div class="card stat">Received this month<strong>${formatMoney(m.paid)}</strong></div>
    <div class="actions">
      <a class="button" href="#/documents/new?type=invoice">New invoice</a>
      <a class="button secondary" href="#/documents/new?type=receipt">New receipt</a>
    </div>
    <h2>Recent</h2>
    ${recent.length ? recent.map(docCard).join('') : '<p class="empty">No invoices yet. Tap + to create your first one.</p>'}`;
}

const docCard = (d) => `
  <a class="card" href="#/documents/edit?id=${d.id}">
    <div class="card-row"><strong>${esc(d.number || `Draft ${d.type}`)}</strong>${chip(d)}</div>
    <div class="card-row"><span class="muted">${esc(d.customer?.name || (d.type === 'receipt' ? 'Walk-in customer' : 'No customer'))}</span>
      <span>${formatMoney(d.totalPence, d.currency)}</span></div>
  </a>`;

// ---------- Documents list ----------
async function renderDocumentList(filter) {
  setTitle('Invoices & receipts');
  const today = localToday();
  const FILTERS = {
    all: ['', []],
    draft: ["status = 'draft'", []],
    unpaid: ["status = 'issued' AND paid_pence < total_pence", []],
    overdue: ["status = 'issued' AND paid_pence < total_pence AND due_date < ?", [today]],
    paid: ["status = 'issued' AND total_pence > 0 AND paid_pence >= total_pence", []],
    void: ["status = 'void'", []],
  };
  const [where, params] = FILTERS[filter] || FILTERS.all;
  const docs = await repo.list('document', { where, params, orderBy: 'issue_date DESC, updated_at DESC' });
  view.innerHTML = `
    <nav class="filters">${Object.keys(FILTERS).map((f) =>
      `<a href="#/documents?filter=${f}" class="${f === filter ? 'active' : ''}">${f}</a>`).join('')}</nav>
    <input class="search" type="search" placeholder="Search number or customer" aria-label="Search">
    <div id="results"></div>`;
  const results = view.querySelector('#results');
  const draw = (term = '') => {
    const t = term.toLowerCase();
    const shown = docs.filter((d) => !t || (d.number || '').toLowerCase().includes(t) || (d.customer?.name || '').toLowerCase().includes(t));
    results.innerHTML = shown.length ? shown.map(docCard).join('')
      : `<p class="empty">${filter === 'overdue' && !t ? 'No overdue invoices 🎉' : 'Nothing here yet.'}</p>`;
  };
  view.querySelector('.search').addEventListener('input', (e) => draw(e.target.value));
  draw();
}

// ---------- Invoice / receipt editor ----------
const newLine = (profile) => ({ id: repo.uuid(), description: '', quantity: 1, unitPricePence: 0, taxRatePercent: profile.defaultTaxRatePercent || 0 });

function validateDocument(doc, issuing) {
  const errors = [];
  if (!doc.issueDate) errors.push('Issue date is required.');
  if (!issuing) return errors;                                   // drafts may be incomplete
  if (doc.type === 'invoice' && !doc.customerId) errors.push('Choose a customer.');
  if (doc.type === 'invoice' && (!doc.dueDate || doc.dueDate < doc.issueDate)) errors.push('Due date must be on or after the issue date.');
  if (!doc.lines.length) errors.push('Add at least one line.');
  doc.lines.forEach((l, i) => {
    if (!l.description.trim()) errors.push(`Line ${i + 1}: add a description.`);
    if (!(l.quantity > 0)) errors.push(`Line ${i + 1}: quantity must be more than 0.`);
    if (l.unitPricePence < 0) errors.push(`Line ${i + 1}: price cannot be negative.`);
    if (l.taxRatePercent < 0 || l.taxRatePercent > 100) errors.push(`Line ${i + 1}: tax must be between 0 and 100%.`);
  });
  return errors;
}

async function renderEditor(id, type = 'invoice') {
  const profile = await repo.getProfile();
  const customers = await repo.list('customer', { orderBy: 'name' });
  const items = await repo.list('item', { orderBy: 'name' });
  const today = localToday();
  const doc = id ? await repo.get('document', id) : {
    type, status: 'draft', number: null, customerId: null, customer: null, issueDate: today,
    dueDate: type === 'invoice' ? addDays(today, profile.paymentTermsDays ?? 14) : null,
    currency: profile.currency || 'GBP', lines: [newLine(profile)], payments: [],
    notes: '', paymentInstructions: profile.paymentInstructions || '',
    subtotalPence: 0, taxPence: 0, totalPence: 0, paidPence: 0,
  };
  if (!doc) { view.innerHTML = '<p class="empty">This document no longer exists.</p>'; return; }
  const isInvoice = doc.type === 'invoice';
  const locked = doc.status === 'void';
  setTitle(doc.number || `New ${doc.type}`);

  view.innerHTML = `
    <form id="doc-form" novalidate>
      ${doc.status !== 'draft' ? `<p>${chip(doc)}</p>` : ''}
      <label>${isInvoice ? 'Customer *' : 'Customer (optional)'}
        <select name="customerId">
          <option value="">${isInvoice ? 'Select a customer…' : 'Walk-in customer'}</option>
          ${customers.map((c) => `<option value="${c.id}" ${c.id === doc.customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      <p><a href="#/customers/new?return=${encodeURIComponent(location.hash)}">+ New customer</a></p>
      <div class="row">
        <label>Issue date <input type="date" name="issueDate" value="${doc.issueDate}" required></label>
        ${isInvoice ? `<label>Due date <input type="date" name="dueDate" value="${doc.dueDate || ''}" required></label>`
          : doc.status === 'draft' ? `<label>Paid by <select name="method">${PAYMENT_METHODS.map((m) =>
            `<option value="${m}">${m.replace('-', ' ')}</option>`).join('')}</select></label>` : ''}
      </div>
      <h2>Items</h2>
      <div class="line-labels"><span>Qty</span><span>Unit price (£)</span><span>Tax %</span><span></span></div>
      <div id="lines"></div>
      <div class="row">
        <button type="button" id="add-line" class="secondary">+ Add line</button>
        <select id="add-item" aria-label="Add a saved item">
          <option value="">+ Saved item…</option>
          ${items.map((i) => `<option value="${i.id}">${esc(i.name)} – ${formatMoney(i.unitPricePence)}</option>`).join('')}
        </select>
      </div>
      <label>Notes <textarea name="notes" maxlength="2000">${esc(doc.notes)}</textarea></label>
      ${isInvoice ? `<label>Payment instructions <textarea name="paymentInstructions" maxlength="1000">${esc(doc.paymentInstructions)}</textarea></label>` : ''}
      <div id="totals" class="totals card"></div>
      <p id="form-error" class="error" role="alert" hidden></p>
      ${locked ? '<p class="muted">This document is void and can no longer be changed.</p>' : `
      <div class="actions">
        <button type="submit" value="draft" class="secondary">${doc.status === 'draft' ? 'Save draft' : 'Save'}</button>
        ${doc.status === 'draft' ? `<button type="submit" value="issue">${isInvoice ? 'Issue invoice' : 'Save receipt'}</button>` : ''}
      </div>`}
      ${doc.status === 'draft'
        ? (id ? '<div class="actions"><button type="button" id="delete" class="danger">Delete draft</button></div>' : '')
        : `<div class="actions">
             <button type="button" id="share-pdf">Share PDF</button>
             ${!locked && doc.paidPence < doc.totalPence ? '<button type="button" id="mark-paid" class="secondary">Mark as paid</button>' : ''}
           </div>
           ${!locked ? `<div class="actions">
             ${doc.paidPence < doc.totalPence ? '<button type="button" id="part-pay" class="secondary">Record part payment</button>' : ''}
             <button type="button" id="void" class="danger">Void</button>
           </div>` : ''}`}
    </form>`;

  const form = view.querySelector('#doc-form');
  const linesEl = form.querySelector('#lines');
  if (locked) form.querySelectorAll('input, select, textarea, #add-line').forEach((el) => { el.disabled = true; });

  const drawTotals = () => {
    const t = documentTotals(doc.lines, doc.payments);
    const m = (p) => formatMoney(p, doc.currency);
    form.querySelector('#totals').innerHTML = `
      <div><span>Subtotal</span><span>${m(t.subtotalPence)}</span></div>
      <div><span>Tax</span><span>${m(t.taxPence)}</span></div>
      <div class="grand"><span>Total</span><span>${m(t.totalPence)}</span></div>
      ${t.paidPence ? `<div><span>Paid</span><span>${m(t.paidPence)}</span></div><div><span>Balance</span><span>${m(t.balancePence)}</span></div>` : ''}`;
  };
  const drawLines = () => {
    linesEl.innerHTML = doc.lines.map((l, i) => `
      <fieldset class="line" data-i="${i}" ${locked ? 'disabled' : ''}>
        <input name="description" placeholder="Description, e.g. Deep clean – 3 bed house" value="${esc(l.description)}" maxlength="500" aria-label="Description">
        <input name="quantity" type="number" inputmode="decimal" min="0" step="0.01" value="${l.quantity}" aria-label="Quantity">
        <input name="unitPrice" type="number" inputmode="decimal" min="0" step="0.01" value="${(l.unitPricePence / 100).toFixed(2)}" aria-label="Unit price">
        <input name="taxRatePercent" type="number" inputmode="decimal" min="0" max="100" step="0.1" value="${l.taxRatePercent}" aria-label="Tax %">
        <button type="button" class="remove secondary" aria-label="Remove line">✕</button>
      </fieldset>`).join('');
    drawTotals();
  };
  drawLines();

  linesEl.addEventListener('input', (e) => {
    const line = doc.lines[Number(e.target.closest('.line').dataset.i)];
    const v = e.target.value;
    if (e.target.name === 'description') line.description = v;
    if (e.target.name === 'quantity') line.quantity = Number(v) || 0;
    if (e.target.name === 'unitPrice') line.unitPricePence = toPence(v || 0);
    if (e.target.name === 'taxRatePercent') line.taxRatePercent = Number(v) || 0;
    drawTotals();
  });
  linesEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('remove')) return;
    doc.lines.splice(Number(e.target.closest('.line').dataset.i), 1);
    drawLines();
  });
  form.querySelector('#add-line').addEventListener('click', () => { doc.lines.push(newLine(profile)); drawLines(); });
  form.querySelector('#add-item').addEventListener('change', (e) => {
    const item = items.find((i) => i.id === e.target.value);
    if (item) {
      doc.lines.push({ ...newLine(profile), description: item.name, unitPricePence: item.unitPricePence,
        taxRatePercent: item.taxRatePercent ?? 0, itemId: item.id });
    }
    e.target.value = '';
    drawLines();
  });

  const recalc = () => { const { balancePence, ...t } = documentTotals(doc.lines, doc.payments); Object.assign(doc, t); };
  const persist = async (message) => {
    recalc();
    await repo.save('document', doc);
    toast(message);
    router();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const issuing = e.submitter?.value === 'issue';
    const fd = new FormData(form);
    Object.assign(doc, {
      customerId: fd.get('customerId') || null,
      issueDate: fd.get('issueDate'),
      dueDate: isInvoice ? fd.get('dueDate') || null : null,
      notes: String(fd.get('notes') || '').trim(),
      paymentInstructions: isInvoice ? String(fd.get('paymentInstructions') || '').trim() : '',
    });
    const errors = validateDocument(doc, issuing || doc.status === 'issued');
    if (errors.length) { showFormError(form, errors); return; }

    const buttons = form.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });     // stops double taps creating two invoices
    try {
      const c = customers.find((x) => x.id === doc.customerId);
      // Snapshot so old PDFs stay accurate if the customer's details change later.
      doc.customer = c ? { name: c.name, email: c.email, phone: c.phone, address: c.address } : null;
      recalc();
      if (issuing && doc.status === 'draft') {
        doc.status = 'issued';
        doc.number = await repo.nextDocumentNumber(doc.type, isInvoice ? profile.invoicePrefix || 'INV-' : profile.receiptPrefix || 'REC-');
        if (!isInvoice && doc.paidPence < doc.totalPence) {
          doc.payments.push({ id: repo.uuid(), amountPence: doc.totalPence - doc.paidPence, date: doc.issueDate, method: fd.get('method') || 'cash' });
          recalc();
        }
      }
      const saved = await repo.save('document', doc);
      toast(saved.number ? `${saved.number} saved` : 'Draft saved');
      go(`#/documents/edit?id=${saved.id}`);
    } catch (err) {
      showError(err);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  });

  form.querySelector('#mark-paid')?.addEventListener('click', () => {
    doc.payments.push({ id: repo.uuid(), amountPence: doc.totalPence - doc.paidPence, date: localToday(), method: 'bank-transfer' });
    persist('Marked as paid');
  });
  form.querySelector('#part-pay')?.addEventListener('click', () => {
    const balance = doc.totalPence - doc.paidPence;
    const answer = prompt(`Amount received (balance ${formatMoney(balance, doc.currency)})`);
    if (answer == null) return;
    let amount;
    try { amount = toPence(answer); } catch { toast('Enter an amount like 25.00'); return; }
    if (amount <= 0 || amount > balance) { toast(`Enter an amount between 0.01 and ${(balance / 100).toFixed(2)}`); return; }
    doc.payments.push({ id: repo.uuid(), amountPence: amount, date: localToday(), method: 'bank-transfer' });
    persist(`Payment of ${formatMoney(amount, doc.currency)} recorded`);
  });
  form.querySelector('#void')?.addEventListener('click', () => {
    if (!confirm(`Void ${doc.number}? It keeps its number but can no longer be changed.`)) return;
    doc.status = 'void';
    persist(`${doc.number} voided`);
  });
  form.querySelector('#share-pdf')?.addEventListener('click', async () => {
    try {
      toast('Creating PDF…');
      await sharePdf(buildPdf(doc, profile), `${doc.number}.pdf`);
    } catch (err) {
      showError(err);
    }
  });
  form.querySelector('#delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this draft?')) return;
    await repo.remove('document', doc.id);
    toast('Draft deleted');
    go('#/documents');
  });
}

// ---------- Customers ----------
async function renderCustomers() {
  setTitle('Customers');
  const customers = await repo.list('customer', { orderBy: 'name COLLATE NOCASE' });
  view.innerHTML = `
    <a class="button" href="#/customers/new">+ New customer</a><br><br>
    ${customers.length ? customers.map((c) => `
      <a class="card" href="#/customers/edit?id=${c.id}"><strong>${esc(c.name)}</strong><br><span class="muted">${esc(c.email || c.phone || '')}</span></a>`).join('')
      : '<p class="empty">No customers yet. Add the people you invoice regularly.</p>'}`;
}

async function renderCustomerForm(id, returnTo) {
  const c = id ? await repo.get('customer', id) : { name: '', email: '', phone: '', address: '', notes: '' };
  if (!c) { view.innerHTML = '<p class="empty">This customer no longer exists.</p>'; return; }
  setTitle(id ? 'Edit customer' : 'New customer');
  view.innerHTML = `
    <form id="customer-form" novalidate>
      <label>Name * <input name="name" required maxlength="120" value="${esc(c.name)}"></label>
      <label>Email <input name="email" type="email" maxlength="200" value="${esc(c.email)}"></label>
      <label>Phone <input name="phone" type="tel" maxlength="40" value="${esc(c.phone)}"></label>
      <label>Address <textarea name="address" maxlength="500">${esc(c.address)}</textarea></label>
      <label>Notes <textarea name="notes" maxlength="2000">${esc(c.notes)}</textarea></label>
      <p id="form-error" class="error" role="alert" hidden></p>
      <div class="actions"><button type="submit">Save customer</button>
        ${id ? '<button type="button" id="delete" class="danger">Delete</button>' : ''}</div>
    </form>`;
  const form = view.querySelector('#customer-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = textFields(new FormData(form), ['name', 'email', 'phone', 'address', 'notes']);
    const errors = [];
    if (!data.name) errors.push('Name is required.');
    if (data.email && !form.elements.email.checkValidity()) errors.push('Enter a valid email address.');
    if (errors.length) { showFormError(form, errors); return; }
    await repo.save('customer', { ...c, ...data });
    toast('Customer saved');
    go(returnTo || '#/customers');
  });
  form.querySelector('#delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this customer? Existing invoices keep their copy of the details.')) return;
    await repo.remove('customer', id);
    go('#/customers');
  });
}

// ---------- Items / services catalogue ----------
async function renderItems() {
  setTitle('Items & services');
  const items = await repo.list('item', { orderBy: 'name COLLATE NOCASE' });
  view.innerHTML = `
    <a class="button" href="#/items/new">+ New item</a><br><br>
    ${items.length ? items.map((i) => `
      <a class="card" href="#/items/edit?id=${i.id}"><div class="card-row"><strong>${esc(i.name)}</strong>
        <span>${formatMoney(i.unitPricePence)}${i.unit ? ` / ${esc(i.unit)}` : ''}</span></div></a>`).join('')
      : '<p class="empty">No saved items yet. Save services you sell often, e.g. "Hourly tutoring".</p>'}`;
}

async function renderItemForm(id) {
  const profile = await repo.getProfile();
  const item = id ? await repo.get('item', id) : { name: '', unitPricePence: 0, unit: 'item', taxRatePercent: profile.defaultTaxRatePercent || 0 };
  if (!item) { view.innerHTML = '<p class="empty">This item no longer exists.</p>'; return; }
  setTitle(id ? 'Edit item' : 'New item');
  view.innerHTML = `
    <form id="item-form" novalidate>
      <label>Name * <input name="name" required maxlength="120" value="${esc(item.name)}"></label>
      <div class="row">
        <label>Unit price (£) <input name="unitPrice" type="number" inputmode="decimal" min="0" step="0.01" value="${(item.unitPricePence / 100).toFixed(2)}"></label>
        <label>Unit <select name="unit">${['item', 'hour', 'day', 'session'].map((u) =>
          `<option ${u === item.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      </div>
      <label>Tax % <input name="taxRatePercent" type="number" min="0" max="100" step="0.1" value="${item.taxRatePercent ?? 0}"></label>
      <p id="form-error" class="error" role="alert" hidden></p>
      <div class="actions"><button type="submit">Save item</button>
        ${id ? '<button type="button" id="delete" class="danger">Delete</button>' : ''}</div>
    </form>`;
  const form = view.querySelector('#item-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    const price = Number(fd.get('unitPrice'));
    const tax = Number(fd.get('taxRatePercent'));
    const errors = [];
    if (!name) errors.push('Name is required.');
    if (!(price >= 0)) errors.push('Unit price must be 0 or more.');
    if (!(tax >= 0 && tax <= 100)) errors.push('Tax must be between 0 and 100%.');
    if (errors.length) { showFormError(form, errors); return; }
    await repo.save('item', { ...item, name, unitPricePence: toPence(price), unit: fd.get('unit'), taxRatePercent: tax });
    toast('Item saved');
    go('#/items');
  });
  form.querySelector('#delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this item?')) return;
    await repo.remove('item', id);
    go('#/items');
  });
}

// ---------- Settings / onboarding ----------
async function renderSettings(onboarding) {
  const p = await repo.getProfile();
  const loggedIn = await isLoggedIn();
  setTitle(onboarding ? 'Welcome' : 'Settings');
  view.innerHTML = `
    ${onboarding ? '<p>Add your business details once – they appear on every invoice. You can change them later. No account or internet needed.</p>' : ''}
    <form id="profile-form" novalidate>
      <label>Business name * <input name="businessName" required maxlength="120" value="${esc(p.businessName)}"></label>
      <label>Address <textarea name="address" maxlength="500">${esc(p.address)}</textarea></label>
      <label>Email <input name="email" type="email" value="${esc(p.email)}"></label>
      <label>Phone <input name="phone" type="tel" value="${esc(p.phone)}"></label>
      <label>VAT number (leave blank if not VAT registered) <input name="vatNumber" maxlength="20" value="${esc(p.vatNumber)}"></label>
      <label>Logo <input name="logo" type="file" accept="image/png,image/jpeg"></label>
      <img id="logo-preview" class="logo" alt="Logo preview" ${p.logoDataUrl ? `src="${p.logoDataUrl}"` : 'hidden'}>
      <div class="row">
        <label>Default tax % <input name="defaultTaxRatePercent" type="number" min="0" max="100" step="0.1" value="${p.defaultTaxRatePercent ?? 0}"></label>
        <label>Payment terms (days) <input name="paymentTermsDays" type="number" min="0" max="365" value="${p.paymentTermsDays ?? 14}"></label>
      </div>
      <label>Payment instructions <textarea name="paymentInstructions" maxlength="1000" placeholder="Bank name, sort code, account number or payment link">${esc(p.paymentInstructions)}</textarea></label>
      <div class="row">
        <label>Invoice prefix <input name="invoicePrefix" maxlength="10" value="${esc(p.invoicePrefix)}"></label>
        <label>Receipt prefix <input name="receiptPrefix" maxlength="10" value="${esc(p.receiptPrefix)}"></label>
      </div>
      <label>Brand colour <input name="brandColour" type="color" value="${esc(p.brandColour || '#2163ba')}"></label>
      <p id="form-error" class="error" role="alert" hidden></p>
      <button type="submit">${onboarding ? 'Start invoicing' : 'Save settings'}</button>
    </form>
    ${onboarding ? '' : `
    <h2>Backup</h2>
    <div class="card"><p class="muted">Save a copy of everything on this phone as a file.</p>
      <button id="export" class="secondary">Export backup</button></div>
    <h2>Cloud backup (optional)</h2>
    <div class="card">
      ${loggedIn
        ? `<p>Signed in as ${esc(await getMeta('user_email'))}</p>
           <div class="actions"><button id="sync-now">Sync now</button><button id="logout" class="secondary">Sign out</button></div>
           <button id="delete-account" class="danger">Delete cloud account</button>`
        : '<p class="muted">Sign in to back up your data and use it on another phone.</p><a class="button" href="#/login">Sign in or create account</a>'}
    </div>`}`;

  let logoDataUrl = p.logoDataUrl || '';
  view.querySelector('[name=logo]').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      logoDataUrl = await resizeImage(file);
      Object.assign(view.querySelector('#logo-preview'), { src: logoDataUrl, hidden: false });
    } catch (err) {
      showError(err);
    }
  });
  const form = view.querySelector('#profile-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const text = textFields(fd, ['businessName', 'address', 'email', 'phone', 'vatNumber', 'paymentInstructions', 'invoicePrefix', 'receiptPrefix', 'brandColour']);
    const errors = [];
    if (!text.businessName) errors.push('Business name is required.');
    if (text.email && !form.elements.email.checkValidity()) errors.push('Enter a valid email address.');
    if (errors.length) { showFormError(form, errors); return; }
    await repo.save('profile', {
      ...p, ...text, logoDataUrl,
      invoicePrefix: text.invoicePrefix || 'INV-', receiptPrefix: text.receiptPrefix || 'REC-',
      defaultTaxRatePercent: Math.min(100, Math.max(0, Number(fd.get('defaultTaxRatePercent')) || 0)),
      paymentTermsDays: Math.min(365, Math.max(0, parseInt(fd.get('paymentTermsDays'), 10) || 0)),
    });
    toast('Settings saved');
    go('#/dashboard');
  });
  view.querySelector('#export')?.addEventListener('click', async () => {
    try {
      const data = await repo.exportAll();
      await shareFile(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `invoice-maker-backup-${localToday()}.json`);
    } catch (err) {
      showError(err);
    }
  });
  view.querySelector('#sync-now')?.addEventListener('click', () => syncNow());
  view.querySelector('#logout')?.addEventListener('click', async () => {
    await logout();
    toast('Signed out – your data stays on this phone');
    router();
  });
  view.querySelector('#delete-account')?.addEventListener('click', async () => {
    if (!confirm('Delete your cloud account and all backed-up data? Data on this phone is kept.')) return;
    try {
      await deleteAccount();
      toast('Cloud account deleted');
      router();
    } catch (err) {
      showError(err);
    }
  });
}

// ---------- Login (online feature) ----------
function renderLogin() {
  setTitle('Cloud backup');
  view.innerHTML = `
    <p class="muted">Your invoices already work offline. An account adds backup and lets you use a second phone.</p>
    <form id="login-form" novalidate>
      <label>Email <input name="email" type="email" autocomplete="email" required></label>
      <label>Password (10+ characters) <input name="password" type="password" autocomplete="current-password" minlength="10" required></label>
      <p id="form-error" class="error" role="alert" hidden></p>
      <div class="actions"><button type="submit" value="login">Sign in</button><button type="submit" value="register" class="secondary">Create account</button></div>
    </form>`;
  const form = view.querySelector('#login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const email = String(fd.get('email')).trim();
    const password = String(fd.get('password'));
    if (!email || !form.elements.email.checkValidity() || password.length < 10) {
      showFormError(form, ['Enter a valid email and a password of at least 10 characters.']);
      return;
    }
    if (!navigator.onLine) { showFormError(form, ['You need an internet connection to sign in. Your data is safe on this phone.']); return; }
    const buttons = form.querySelectorAll('button');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await (e.submitter?.value === 'register' ? register(email, password) : login(email, password));
      toast('Signed in – backing up your data');
      syncNow();
      go('#/settings');
    } catch (err) {
      showFormError(form, [err.message]);
    } finally {
      buttons.forEach((b) => { b.disabled = false; });
    }
  });
}

// ---------- Conflict review ----------
async function renderConflicts() {
  setTitle('Review changes');
  const rows = await query('SELECT * FROM conflicts ORDER BY created_at DESC');
  view.innerHTML = rows.length ? `
    <p class="muted">These documents were changed on two devices. The newest version was kept; you can restore the other one.</p>
    ${rows.map((r) => {
      const local = JSON.parse(r.local_data);
      const server = JSON.parse(r.server_data);
      return `<div class="card" data-id="${r.id}">
        <strong>${esc(local.number || server.number || 'Draft')}</strong>
        <p class="muted">This phone: ${formatMoney(local.totalPence, local.currency)} · edited ${new Date(local.updatedAt).toLocaleString()}<br>
        Other device: ${formatMoney(server.totalPence, server.currency)} · edited ${new Date(server.updatedAt).toLocaleString()}</p>
        <div class="actions"><button class="secondary" data-act="local">Use this phone's</button>
          <button class="secondary" data-act="server">Use other device's</button>
          <button data-act="dismiss">Keep current</button></div>
      </div>`;
    }).join('')}` : '<p class="empty">No conflicts to review.</p>';
  view.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', async () => {
    const card = btn.closest('[data-id]');
    const row = rows.find((r) => r.id === card.dataset.id);
    if (btn.dataset.act !== 'dismiss') {
      const chosen = JSON.parse(btn.dataset.act === 'local' ? row.local_data : row.server_data);
      const current = await repo.get('document', chosen.id);
      await repo.save('document', { ...chosen, version: current?.version ?? chosen.version, deletedAt: null });
    }
    await query('DELETE FROM conflicts WHERE id = ?', [row.id]);
    toast('Done');
    router();
    refreshBanner();
  }));
}

// ---------- Sync / conflict banner ----------
let lastSync = { state: 'idle' };
let hideTimer;
async function refreshBanner() {
  const el = document.getElementById('sync-banner');
  const [{ n: conflicts }] = await query('SELECT COUNT(*) AS n FROM conflicts');
  const s = lastSync;
  const waiting = s.pending ? ` (${s.pending} waiting to sync)` : '';
  let text = {
    idle: s.pending ? `Saved on this phone${waiting}` : '',
    offline: `Offline – changes are saved on this phone${waiting}`,
    syncing: 'Syncing…',
    synced: s.lastSyncAt && `All changes backed up · ${new Date(s.lastSyncAt).toLocaleTimeString()}`,
    failed: `Couldn't sync${waiting}. We'll retry automatically.`,
  }[s.state];
  let state = s.state;
  if (conflicts && s.state !== 'syncing') {
    text = `${conflicts} document${conflicts > 1 ? 's were' : ' was'} changed on another device – Review`;
    state = 'conflict';
  }
  el.hidden = !text;
  el.className = `banner banner-${state}`;
  el.textContent = text || '';
  el.onclick = state === 'conflict' ? () => go('#/conflicts') : null;
  clearTimeout(hideTimer);
  if (state === 'synced') hideTimer = setTimeout(() => { el.hidden = true; }, 3000);
}
document.addEventListener('sync:status', ({ detail }) => { lastSync = detail; refreshBanner(); });

// ---------- Start-up ----------
document.addEventListener('deviceready', async () => {
  try {
    await openDb();
    await migrate();
    window.addEventListener('hashchange', router);
    // Refresh list screens when synced data arrives (never re-render a form the user is typing in).
    document.addEventListener('data:pulled', () => {
      if (!/\/(edit|new)|settings|login|onboarding/.test(location.hash)) router();
    });
    document.addEventListener('pause', () => syncNow());
    startSync();
    const profile = await repo.getProfile();
    go(profile.businessName ? (location.hash || '#/dashboard') : '#/onboarding');
  } catch (e) {
    view.innerHTML = `<p class="error">Could not open local storage: ${esc(e.message)}</p>`;
  }
});
