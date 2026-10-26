// Thin promise wrapper around cordova-sqlite-storage with versioned migrations.
let db;

// Table + indexed columns ([column, recordField]) for each syncable entity.
export const ENTITIES = {
  profile: { table: 'business_profile', columns: [] },
  customer: { table: 'customers', columns: [['name', 'name']] },
  item: { table: 'items', columns: [['name', 'name']] },
  document: {
    table: 'documents',
    columns: [['type', 'type'], ['number', 'number'], ['customer_id', 'customerId'], ['status', 'status'],
      ['issue_date', 'issueDate'], ['due_date', 'dueDate'], ['total_pence', 'totalPence'], ['paid_pence', 'paidPence']],
  },
};

const common = 'data TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, deleted_at TEXT';

// Never edit a released migration – append a new array instead.
const MIGRATIONS = [
  [
    `CREATE TABLE business_profile (id TEXT PRIMARY KEY, ${common})`,
    `CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, ${common})`,
    'CREATE INDEX idx_customers_name ON customers(name)',
    `CREATE TABLE items (id TEXT PRIMARY KEY, name TEXT, ${common})`,
    `CREATE TABLE documents (id TEXT PRIMARY KEY, type TEXT NOT NULL, number TEXT, customer_id TEXT,
       status TEXT NOT NULL, issue_date TEXT, due_date TEXT, total_pence INTEGER NOT NULL DEFAULT 0,
       paid_pence INTEGER NOT NULL DEFAULT 0, ${common})`,
    'CREATE INDEX idx_documents_status_due ON documents(status, due_date)',
    `CREATE TABLE outbox (entity TEXT NOT NULL, record_id TEXT NOT NULL, op TEXT NOT NULL, op_id TEXT NOT NULL,
       queued_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, PRIMARY KEY (entity, record_id))`,
    `CREATE TABLE conflicts (id TEXT PRIMARY KEY, entity TEXT NOT NULL, record_id TEXT NOT NULL,
       local_data TEXT, server_data TEXT, created_at TEXT NOT NULL)`,
  ],
];

export function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.sqlitePlugin) {
      reject(new Error('SQLite is only available on a device or emulator'));
      return;
    }
    db = window.sqlitePlugin.openDatabase({ name: 'invoice-maker.db', location: 'default' }, resolve, reject);
  });
}

export function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.executeSql(sql, params, (rs) => {
      const rows = [];
      for (let i = 0; i < rs.rows.length; i++) rows.push(rs.rows.item(i));
      resolve(rows);
    }, reject);
  });
}

// All statements succeed together or none are applied.
export function batch(statements) {
  return new Promise((resolve, reject) => db.sqlBatch(statements, resolve, reject));
}

export async function getMeta(key) {
  const [row] = await query('SELECT value FROM meta WHERE key = ?', [key]);
  return row ? row.value : null;
}

export function setMeta(key, value) {
  return value == null
    ? query('DELETE FROM meta WHERE key = ?', [key])
    : query('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, String(value)]);
}

export async function migrate() {
  await query('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const current = Number(await getMeta('schema_version') || 0);
  for (let v = current; v < MIGRATIONS.length; v++) {
    await batch([...MIGRATIONS[v], ['INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['schema_version', String(v + 1)]]]);
  }
}
