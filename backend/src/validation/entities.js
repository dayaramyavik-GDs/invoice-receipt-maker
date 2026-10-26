const { z } = require('zod');

// passthrough() keeps fields this schema doesn't list, so a newer app version never loses data
// in a round trip. Record data is never used in query filters, so this is safe.
const money = z.number().int().min(0).max(1e11);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalEmail = z.union([z.literal(''), z.string().email().max(200)]).optional();
const text = (max) => z.string().max(max).optional();

const customer = z.object({
  name: z.string().trim().min(1).max(120), email: optionalEmail, phone: text(40), address: text(500), notes: text(2000),
}).passthrough();

const item = z.object({
  name: z.string().trim().min(1).max(120), unitPricePence: money, unit: text(20),
  taxRatePercent: z.number().min(0).max(100).optional(),
}).passthrough();

const line = z.object({
  description: z.string().max(500), quantity: z.number().min(0).max(1e6), unitPricePence: money,
  taxRatePercent: z.number().min(0).max(100).default(0),
}).passthrough();

const payment = z.object({
  id: z.string().max(64), amountPence: money, date: isoDate, method: z.enum(['cash', 'card', 'bank-transfer', 'other']),
}).passthrough();

const document = z.object({
  type: z.enum(['invoice', 'receipt']), status: z.enum(['draft', 'issued', 'void']),
  number: z.string().max(30).nullable().optional(), issueDate: isoDate, dueDate: isoDate.nullable().optional(),
  currency: z.string().length(3), lines: z.array(line).max(200), payments: z.array(payment).max(100).default([]),
  subtotalPence: money, taxPence: money, totalPence: money, paidPence: money,
  notes: text(2000), paymentInstructions: text(1000),
}).passthrough();

const profile = z.object({
  businessName: z.string().trim().min(1).max(120), email: optionalEmail,
  logoDataUrl: z.union([z.literal(''), z.string().max(1_500_000).regex(/^data:image\/(png|jpeg);base64,/)]).optional(),
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  defaultTaxRatePercent: z.number().min(0).max(100).optional(),
}).passthrough();

module.exports = { validators: { customer, item, document, profile } };
