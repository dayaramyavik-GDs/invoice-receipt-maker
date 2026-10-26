import { CONFIG } from './config.js';
import { fetchWithTimeout } from './network.js';
import { getMeta, setMeta } from './db.js';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.details?.[0]?.message || body?.error || `Server error (${status})`);
    this.status = status;
  }
}

async function call(path, { method = 'GET', body, token } = {}) {
  let res;
  try {
    res = await fetchWithTimeout(`${CONFIG.API_ORIGIN}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Your data is safe on this phone.');
  }
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

async function saveTokens({ accessToken, refreshToken, user }) {
  await setMeta('access_token', accessToken);
  await setMeta('refresh_token', refreshToken);
  if (user) await setMeta('user_email', user.email);
}

export const login = async (email, password) => saveTokens(await call('/auth/login', { method: 'POST', body: { email, password } }));
export const register = async (email, password) => saveTokens(await call('/auth/register', { method: 'POST', body: { email, password } }));
export const isLoggedIn = async () => Boolean(await getMeta('refresh_token'));

export async function logout() {
  for (const key of ['access_token', 'refresh_token', 'user_email', 'last_pull_seq']) await setMeta(key, null);
}

// Authenticated call that refreshes an expired access token once.
export async function authed(path, options = {}) {
  try {
    return await call(path, { ...options, token: await getMeta('access_token') });
  } catch (e) {
    if (e.status !== 401) throw e;
    const refreshToken = await getMeta('refresh_token');
    if (!refreshToken) throw e;
    const tokens = await call('/auth/refresh', { method: 'POST', body: { refreshToken } });
    await saveTokens(tokens);
    return call(path, { ...options, token: tokens.accessToken });
  }
}

export async function deleteAccount() {
  await authed('/auth/account', { method: 'DELETE' });
  await logout();
}
