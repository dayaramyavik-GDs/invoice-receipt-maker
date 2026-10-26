import { CONFIG } from './config.js';

const listeners = new Set();
let online = navigator.onLine;

export const isOnline = () => online;
export const onNetworkChange = (fn) => listeners.add(fn);

function set(value) {
  if (value === online) return;
  online = value;
  listeners.forEach((fn) => fn(value));
}
document.addEventListener('online', () => set(true));   // cordova-plugin-network-information
document.addEventListener('offline', () => set(false));
window.addEventListener('online', () => set(true));
window.addEventListener('offline', () => set(false));

export async function fetchWithTimeout(url, options = {}, ms = CONFIG.REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// "Connected to Wi-Fi" is not the same as "can reach our server" – and the reverse also happens:
// some Android WebViews keep reporting offline after airplane mode ends. So we always ask the server,
// and a successful answer also corrects our own online flag.
export async function canReachServer() {
  if (!CONFIG.API_ORIGIN) return false;
  try {
    const ok = (await fetchWithTimeout(`${CONFIG.API_ORIGIN}/health/live`, {}, 5000)).ok;
    if (ok) set(true);
    return ok;
  } catch {
    return false;
  }
}
