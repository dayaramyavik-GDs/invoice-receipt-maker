// Document numbering. Pure functions (no DOM / database) so they can be unit tested in Node.

// A device code (e.g. "A") makes each phone's numbers distinct: INV-A-0001 vs INV-B-0001,
// so two phones issuing invoices while both offline can never pick the same number.
export function numberPrefix(prefix, deviceCode = '') {
  const code = String(deviceCode || '').trim().toUpperCase();
  return code ? `${prefix}${code}-` : prefix;
}

export function cleanDeviceCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
}

// Next number = highest existing number with this exact prefix + 1.
export function nextNumber(existingNumbers, prefix) {
  const max = existingNumbers.reduce((m, n) => {
    if (!n || !n.startsWith(prefix)) return m;
    const rest = n.slice(prefix.length);
    return /^\d+$/.test(rest) ? Math.max(m, Number(rest)) : m;   // INV-A-0003 doesn't count towards INV-0003
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

// Numbers used by more than one live document of the same type (e.g. two phones both issued INV-0006 offline).
// Voided documents don't count, so voiding one copy and re-issuing it resolves the clash.
export function findDuplicateNumbers(documents) {
  const seen = new Map();
  for (const d of documents) {
    if (!d.number || d.deletedAt || d.status === 'void') continue;
    const key = `${d.type}:${d.number}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([key]) => key.split(':')[1]);
}
