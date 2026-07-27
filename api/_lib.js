// Zero-dependency Supabase access for serverless functions: plain fetch
// against PostgREST (/rest/v1) and GoTrue (/auth/v1) with the service key.

const base = () => process.env.SUPABASE_URL;
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

export const configured = () => !!(base() && key());

export function notConfigured(res) {
  return res
    .status(503)
    .json({ error: 'Backend not configured yet — Supabase env vars are missing.' });
}

async function call(url, method, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg =
      json?.message || json?.msg || json?.error_description || json?.error ||
      `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
}

// PostgREST. Pass Prefer headers via `headers` when you need representation.
export const rest = (method, path, body, headers) =>
  call(`${base()}/rest/v1${path}`, method, body, headers);

// GoTrue. Pass a user JWT to act as that user (e.g. GET /user).
export const auth = (method, path, body, userJwt) =>
  call(
    `${base()}/auth/v1${path}`,
    method,
    body,
    userJwt ? { Authorization: `Bearer ${userJwt}` } : {}
  );

export const clip = (v, max) => String(v ?? '').trim().slice(0, max);

export function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = (n) =>
    Array.from(crypto.getRandomValues(new Uint32Array(n)))
      .map((x) => abc[x % abc.length])
      .join('');
  return `quik-${pick(4)}-${pick(4)}`;
}
