// All money is integer minor units (pence) to avoid floating-point errors like 0.1 + 0.2.
export function toPence(input) {
  const cleaned = String(input).replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  if (!/\d/.test(cleaned) || !Number.isFinite(n)) throw new Error('Invalid amount');
  return Math.round(n * 100);
}

export function formatMoney(pence, currency = 'GBP', locale = 'en-GB') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format((pence || 0) / 100);
}

// Tax is rounded per line (an accepted UK VAT method).
export function lineTotals({ quantity, unitPricePence, taxRatePercent = 0 }) {
  const net = Math.round(Number(quantity) * unitPricePence);
  const tax = Math.round((net * Number(taxRatePercent)) / 100);
  return { net, tax, total: net + tax };
}

export function documentTotals(lines = [], payments = []) {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const t = lineTotals(l);
    subtotal += t.net;
    tax += t.tax;
  }
  const total = subtotal + tax;
  const paid = payments.reduce((s, p) => s + p.amountPence, 0);
  return { subtotalPence: subtotal, taxPence: tax, totalPence: total, paidPence: paid, balancePence: total - paid };
}

export function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

// Stored status is draft | issued | void; the rest is derived so it is never out of date.
export function deriveStatus(doc, today = localToday()) {
  if (doc.status === 'draft' || doc.status === 'void') return doc.status;
  if (doc.totalPence > 0 && doc.paidPence >= doc.totalPence) return 'paid';
  if (doc.dueDate && doc.dueDate < today) return 'overdue';
  return doc.paidPence > 0 ? 'part-paid' : 'unpaid';
}
