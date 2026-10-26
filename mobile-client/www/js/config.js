export const CONFIG = {
  // Dev: your Cloudflare tunnel URL. Production: https://api.example.com
  // (The browser dev server in dev/serve.mjs overrides this with http://localhost:3000.)
  API_ORIGIN: window.__API_ORIGIN__ || 'https://api.example.com',
  SYNC_INTERVAL_MS: 5 * 60 * 1000,
  REQUEST_TIMEOUT_MS: 10000,
};
