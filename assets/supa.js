// Shared client-side plumbing for the QuikQuoteAI workspace.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const cfg = window.QQ_CONFIG || {};
export const configured = !!(
  cfg.SUPABASE_URL &&
  cfg.SUPABASE_ANON_KEY &&
  !/YOUR-PROJECT|YOUR-ANON/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)
);

export const supa = configured
  ? createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
  : null;

/* ---------- tiny DOM + format helpers ---------- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
}

export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const usdCents = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

export const fmtMoney = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? usd.format(v) : usdCents.format(v);
};

export const fmtRange = (low, high) => {
  const l = Number(low) || 0;
  const h = Number(high) || 0;
  if (!l && !h) return '$—';
  if (l === h) return fmtMoney(l);
  return `${fmtMoney(l)}–${fmtMoney(h)}`;
};

export const padEst = (n) => String(n ?? 0).padStart(4, '0');

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 30) return `${Math.floor(d)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/* ---------- toasts ---------- */

let toastRoot;
export function toast(msg, kind = 'ok') {
  if (!toastRoot) {
    toastRoot = el('div', 'toast-root');
    document.body.appendChild(toastRoot);
  }
  const t = el('div', `toast ${kind}`, esc(msg));
  toastRoot.appendChild(t);
  setTimeout(() => {
    t.classList.add('bye');
    setTimeout(() => t.remove(), 350);
  }, 3600);
}

/* ---------- auth / context ---------- */

export async function getSession() {
  if (!supa) return null;
  const { data } = await supa.auth.getSession();
  return data.session || null;
}

export async function requireAuth() {
  const session = await getSession();
  if (!session) {
    window.location.href = '/portal';
    return null;
  }
  return session;
}

// Loads everything the workspace needs to know about who's signed in.
export async function loadContext(session) {
  const user = session.user;
  const { data: profile } = await supa
    .from('profiles')
    .select('user_id, email, full_name, role')
    .eq('user_id', user.id)
    .maybeSingle();

  const isOwner = profile?.role === 'owner';

  let businesses = [];
  if (isOwner) {
    const { data } = await supa
      .from('businesses')
      .select('*')
      .order('created_at', { ascending: false });
    businesses = data || [];
  } else {
    const { data } = await supa
      .from('businesses')
      .select('*, business_members!inner(user_id)')
      .eq('business_members.user_id', user.id)
      .order('created_at', { ascending: false });
    businesses = data || [];
  }

  return { user, profile, isOwner, businesses };
}

export async function signOut() {
  try {
    await supa?.auth.signOut();
  } finally {
    window.location.href = '/portal';
  }
}
