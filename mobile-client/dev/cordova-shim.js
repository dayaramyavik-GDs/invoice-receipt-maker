// Browser-only stand-in for cordova.js + cordova-sqlite-storage (served by dev/serve.mjs, never packaged).
// SQLite runs in WebAssembly via sql.js and is saved to localStorage after every write.
window.__API_ORIGIN__ = 'http://localhost:3000';

(async () => {
  const KEY = 'invoice-maker-dev-db';
  const SQL = await window.initSqlJs({ locateFile: (f) => `/__dev/${f}` });
  const saved = localStorage.getItem(KEY);
  const db = saved ? new SQL.Database(Uint8Array.from(atob(saved), (c) => c.charCodeAt(0))) : new SQL.Database();

  const persist = () => {
    const bytes = db.export();
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    localStorage.setItem(KEY, btoa(s));
  };
  const run = (sql, params = []) => {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(params.map((v) => (v === undefined ? null : v)));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  };
  const result = (rows) => ({ rows: { length: rows.length, item: (i) => rows[i] }, rowsAffected: db.getRowsModified() });
  const isWrite = (sql) => !/^\s*select/i.test(sql);

  const handle = {
    executeSql(sql, params, ok, fail) {
      setTimeout(() => {
        try {
          const rows = run(sql, params);
          if (isWrite(sql)) persist();
          ok?.(result(rows));
        } catch (e) {
          fail?.(e);
        }
      });
    },
    sqlBatch(statements, ok, fail) {
      setTimeout(() => {
        try {
          run('BEGIN');
          for (const s of statements) Array.isArray(s) ? run(s[0], s[1]) : run(s);
          run('COMMIT');
          persist();
          ok?.();
        } catch (e) {
          try { run('ROLLBACK'); } catch { /* already rolled back */ }
          fail?.(e);
        }
      });
    },
  };
  window.sqlitePlugin = { openDatabase: (opts, ok) => { setTimeout(() => ok?.(handle)); return handle; } };
  window.__resetDevDb = () => { localStorage.removeItem(KEY); location.reload(); };

  if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r));
  document.dispatchEvent(new Event('deviceready'));
})();
