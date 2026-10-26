export const CONFIG = {
  // Set at build time from api.config.json / API_ORIGIN (see scripts/apply-api-origin.js).
  // Empty means this build has no cloud sync; everything else works offline.
  API_ORIGIN: window.__API_ORIGIN__ || '',
  SYNC_INTERVAL_MS: 5 * 60 * 1000,
  REQUEST_TIMEOUT_MS: 10000,
};
