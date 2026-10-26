import { formatMoney, lineTotals } from './money.js';
import { shareFile } from './share.js';

const PAGE = { w: 210, h: 297, m: 15 };
const COLS = [
  { label: 'Description', x: 15 },
  { label: 'Qty', x: 125, align: 'right' },
  { label: 'Unit price', x: 152, align: 'right' },
  { label: 'Tax', x: 167, align: 'right' },
  { label: 'Amount', x: 195, align: 'right' },
];

const hexToRgb = (hex) => { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function block(pdf, title, lines, x, y, width = 85) {
  pdf.setFont('helvetica', 'bold').text(title, x, y);
  const text = pdf.splitTextToSize(lines.filter(Boolean).join('\n'), width);
  pdf.setFont('helvetica', 'normal').text(text, x, y + 5);
  return 5 + text.length * 5;
}

// Generates a branded A4 PDF entirely on the device (no internet needed).
export function buildPdf(doc, profile) {
  const jsPDF = window.jspdf?.jsPDF;
  if (!jsPDF) throw new Error('PDF library missing – run npm install in mobile-client');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const brand = hexToRgb(profile.brandColour || '#2163ba');
  const money = (p) => formatMoney(p, doc.currency);
  const right = PAGE.w - PAGE.m;
  let y = PAGE.m;

  if (profile.logoDataUrl) {
    const { width, height } = pdf.getImageProperties(profile.logoDataUrl);
    // 'FAST' compression keeps the logo from making every PDF ~300 KB.
    pdf.addImage(profile.logoDataUrl, 'PNG', PAGE.m, y, Math.min(60, (width / height) * 25), 25, 'logo', 'FAST');
  }
  pdf.setFont('helvetica', 'bold').setFontSize(22).setTextColor(...brand)
    .text(doc.type === 'receipt' ? 'RECEIPT' : 'INVOICE', right, y + 8, { align: 'right' });
  const meta = [`No. ${doc.number}`, `Date: ${fmtDate(doc.issueDate)}`];
  if (doc.type === 'invoice' && doc.dueDate) meta.push(`Due: ${fmtDate(doc.dueDate)}`);
  pdf.setFont('helvetica', 'normal').setFontSize(10).setTextColor(0).text(meta, right, y + 15, { align: 'right' });

  y = 50;
  const fromH = block(pdf, 'From', [profile.businessName, profile.address, profile.email, profile.phone,
    profile.vatNumber && `VAT no. ${profile.vatNumber}`], PAGE.m, y);
  const toH = doc.customer ? block(pdf, doc.type === 'receipt' ? 'Received from' : 'Bill to',
    [doc.customer.name, doc.customer.address, doc.customer.email], 110, y) : 0;
  y += Math.max(fromH, toH) + 10;

  const header = () => {
    pdf.setFillColor(...brand).rect(PAGE.m - 2, y - 5, right - PAGE.m + 4, 8, 'F');
    pdf.setTextColor(255).setFont('helvetica', 'bold');
    COLS.forEach((c) => pdf.text(c.label, c.x, y, { align: c.align || 'left' }));
    pdf.setTextColor(0).setFont('helvetica', 'normal');
    y += 8;
  };
  header();
  for (const l of doc.lines) {
    const desc = pdf.splitTextToSize(l.description || '', 85);
    const rowH = desc.length * 5 + 2;
    if (y + rowH > PAGE.h - 40) { pdf.addPage(); y = PAGE.m + 5; header(); }
    pdf.text(desc, COLS[0].x, y);
    pdf.text(String(l.quantity), COLS[1].x, y, { align: 'right' });
    pdf.text(money(l.unitPricePence), COLS[2].x, y, { align: 'right' });
    pdf.text(`${l.taxRatePercent || 0}%`, COLS[3].x, y, { align: 'right' });
    pdf.text(money(lineTotals(l).net), COLS[4].x, y, { align: 'right' });
    y += rowH;
  }

  if (y > PAGE.h - 70) { pdf.addPage(); y = PAGE.m; }
  y += 2;
  pdf.line(120, y, right, y);
  y += 6;
  const rows = [['Subtotal', doc.subtotalPence], ['Tax', doc.taxPence], ['Total', doc.totalPence]];
  if (doc.paidPence) rows.push(['Paid', -doc.paidPence], ['Balance due', doc.totalPence - doc.paidPence]);
  for (const [label, value] of rows) {
    pdf.setFont('helvetica', label === 'Total' || label === 'Balance due' ? 'bold' : 'normal');
    pdf.text(label, 130, y).text(money(value), right, y, { align: 'right' });
    y += 6;
  }

  if (doc.totalPence > 0 && doc.paidPence >= doc.totalPence) {
    pdf.setTextColor(31, 143, 78).setFontSize(26).setFont('helvetica', 'bold').text('PAID', PAGE.m, y - 6);
    pdf.setTextColor(0).setFontSize(10).setFont('helvetica', 'normal');
  }
  y += 6;
  if (doc.type === 'invoice' && doc.paymentInstructions) y += block(pdf, 'How to pay', [doc.paymentInstructions], PAGE.m, y, 180) + 4;
  if (doc.notes) block(pdf, 'Notes', [doc.notes], PAGE.m, y, 180);
  return pdf;
}

export const sharePdf = (pdf, filename) => shareFile(pdf.output('blob'), filename);
