import { query, batch, getMeta, ENTITIES } from './db.js';
import { numberPrefix, nextNumber } from './numbering.js';

export const PROFILE_ID = 'profile';
export const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

export const stripMeta = ({ id, updatedAt, version, deletedAt, ...data }) => data;

export function rowToRecord(row) {
  return { ...JSON.parse(row.data), id: row.id, updatedAt: row.updated_at, version: row.version, deletedAt: row.deleted_at };
}

// Builds the upsert (+ optional outbox) statements so a record and its pending-sync marker are saved atomically.
// Local edits keep synced_data (the last server copy); records coming from the server also update it.
export function upsertStatements(entity, record, { queue = true } = {}) {
  const { table, columns } = ENTITIES[entity];
  const data = stripMeta(record);
  const json = JSON.stringify(data);
  const cols = ['id', ...columns.map(([c]) => c), 'data', 'updated_at', 'version', 'deleted_at', ...(queue ? [] : ['synced_data'])];
  const vals = [record.id, ...columns.map(([, f]) => data[f] ?? null), json,
    record.updatedAt, record.version || 0, record.deletedAt || null, ...(queue ? [] : [json])];
  const updates = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
  const stmts = [[`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${updates}`, vals]];
  if (queue) {
    stmts.push(['INSERT OR REPLACE INTO outbox (entity, record_id, op, op_id, queued_at, attempts) VALUES (?, ?, ?, ?, ?, 0)',
      [entity, record.id, record.deletedAt ? 'delete' : 'upsert', uuid(), now()]]);
  }
  return stmts;
}

export const applyServerStatements = (entity, record) => upsertStatements(entity, record, { queue: false });

const changed = () => document.dispatchEvent(new CustomEvent('data:changed'));

export async function save(entity, record) {
  const saved = { ...record, id: record.id || uuid(), updatedAt: now() };
  await batch(upsertStatements(entity, saved));
  changed();
  return saved;
}

// Soft delete: the tombstone syncs so other devices remove it too.
export async function remove(entity, id) {
  const existing = await get(entity, id);
  if (!existing) return;
  await batch(upsertStatements(entity, { ...existing, deletedAt: now(), updatedAt: now() }));
  changed();
}

export async function get(entity, id) {
  const [row] = await query(`SELECT * FROM ${ENTITIES[entity].table} WHERE id = ? AND deleted_at IS NULL`, [id]);
  return row ? rowToRecord(row) : null;
}

// `where` and `orderBy` come from app code only – never from user input.
export async function list(entity, { where = '', params = [], orderBy = 'updated_at DESC', limit } = {}) {
  const sql = `SELECT * FROM ${ENTITIES[entity].table} WHERE deleted_at IS NULL${where ? ` AND (${where})` : ''}`
    + ` ORDER BY ${orderBy}${limit ? ` LIMIT ${Number(limit)}` : ''}`;
  return (await query(sql, params)).map(rowToRecord);
}

export async function getProfile() {
  return (await get('profile', PROFILE_ID)) || {
    id: PROFILE_ID, version: 0, currency: 'GBP', paymentTermsDays: 14, defaultTaxRatePercent: 0,
    invoicePrefix: 'INV-', receiptPrefix: 'REC-',
  };
}

// Next number = highest existing + 1, so it stays correct after pulling data from another device.
// This phone's device code (Settings, stored only on this phone) gives it its own sequence.
export async function nextDocumentNumber(type, prefix) {
  const fullPrefix = numberPrefix(prefix, await getMeta('device_code'));
  const rows = await query('SELECT number FROM documents WHERE type = ? AND number LIKE ?', [type, `${fullPrefix}%`]);
  return nextNumber(rows.map((r) => r.number), fullPrefix);
}

// Everything on this phone as one JSON file (Settings → Export backup).
export async function exportAll() {
  const out = { exportedAt: now(), app: 'invoice-maker', schema: 1 };
  for (const [entity, { table }] of Object.entries(ENTITIES)) {
    out[entity] = (await query(`SELECT * FROM ${table}`)).map(rowToRecord);
  }
  return out;
}
