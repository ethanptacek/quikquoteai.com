// QuikQuoteAI workspace — dashboard, quotes, CRM, access management.
import {
  supa, configured, requireAuth, loadContext, signOut,
  $, $$, el, esc, fmtRange, fmtMoney, padEst, timeAgo, toast,
} from './supa.js';

const state = {
  session: null,
  ctx: null,          // { user, profile, isOwner, businesses }
  view: 'dashboard',
  quotes: [],
  leads: [],
  bizRows: [],
  quoteFilter: { q: '', status: 'all', business: null },
};

const main = $('#ws-main');

/* ================= boot ================= */

async function boot() {
  if (!configured) return gateNotConfigured();

  state.session = await requireAuth();
  if (!state.session) return;

  supa.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') window.location.href = '/portal';
  });

  state.ctx = await loadContext(state.session);
  if (!state.ctx.profile) {
    toast('No profile found for this account.', 'err');
    return signOut();
  }

  paintChrome();

  if (state.session.user.user_metadata?.must_change_password) {
    gatePasswordChange();
  }

  const startView = (location.hash || '').replace('#/', '') || 'dashboard';
  go(allowedView(startView), true);

  window.addEventListener('hashchange', () => {
    const v = allowedView((location.hash || '').replace('#/', ''));
    if (v !== state.view) go(v, true);
  });
}

function allowedView(v) {
  const ownerOnly = ['leads', 'clients'];
  const known = ['dashboard', 'inbox', 'quotes', 'leads', 'clients', 'settings'];
  if (!known.includes(v)) return 'dashboard';
  if (!state.ctx.isOwner && ownerOnly.includes(v)) return 'dashboard';
  return v;
}

/* ---------- theme ---------- */

const THEME_ICONS = {
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5"/></svg>',
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/></svg>',
};

function paintThemeBtn() {
  const t = document.documentElement.dataset.theme || 'dark';
  // Show the icon of the mode you'd switch TO.
  $('#theme-btn').innerHTML = t === 'dark' ? THEME_ICONS.dark : THEME_ICONS.light;
}

function wireTheme() {
  paintThemeBtn();
  $('#theme-btn').addEventListener('click', () => {
    const next = (document.documentElement.dataset.theme || 'dark') === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('qq-theme', next); } catch (e) { /* private mode */ }
    paintThemeBtn();
  });
}

function paintChrome() {
  const { profile, isOwner } = state.ctx;
  const name = profile.full_name || profile.email;
  $('#ws-user').hidden = false;
  $('#signout-btn').hidden = false;
  $('#ws-name').textContent = name;
  $('#ws-role').textContent = isOwner ? 'owner' : 'client';
  $('#ws-avatar').textContent = (name || '?')
    .split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() || '').join('') || '?';
  $('#signout-btn').addEventListener('click', signOut);
  if (isOwner) $$('[data-owner]').forEach((el) => (el.hidden = false));

  $$('.side-link').forEach((b) =>
    b.addEventListener('click', () => go(b.dataset.view))
  );
  wireTheme();
}

function go(view, skipHash) {
  state.view = view;
  if (!skipHash) location.hash = `/${view}`;
  $$('.side-link').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  closeDrawer();
  render();
}

/* ================= gates ================= */

function gateNotConfigured() {
  $('#gate-root').innerHTML = `
    <div class="gate">
      <div class="form-card" style="display:grid; gap:14px;">
        <p class="eyebrow">Not wired up yet</p>
        <h3>The backend isn’t connected.</h3>
        <p style="color:var(--text-2); margin:0;">Honest status: this workspace ships with the site, but its Supabase project hasn’t been provisioned yet. Once it is, sign-in works and this screen disappears.</p>
        <a class="btn btn-line btn-sm" href="/">← Back to the site</a>
      </div>
    </div>`;
}

function gatePasswordChange() {
  const root = $('#gate-root');
  root.innerHTML = `
    <div class="gate">
      <div class="form-card" style="display:grid; gap:16px;">
        <div>
          <p class="eyebrow">First sign-in</p>
          <h3 style="margin-bottom:6px;">Set your own password.</h3>
          <p class="mono-note">THE TEMPORARY ONE GETS RETIRED NOW</p>
        </div>
        <form id="pw-gate-form" style="display:grid; gap:14px;">
          <div class="field">
            <label for="gate-pw1">New password</label>
            <input id="gate-pw1" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required>
          </div>
          <div class="field">
            <label for="gate-pw2">Once more</label>
            <input id="gate-pw2" type="password" autocomplete="new-password" minlength="8" placeholder="Same thing again" required>
          </div>
          <button class="btn btn-fill" type="submit">Save password →</button>
          <div class="form-status" id="gate-status"></div>
        </form>
        <button class="btn-ghost" id="gate-signout">Sign out instead</button>
      </div>
    </div>`;

  $('#gate-signout').addEventListener('click', signOut);
  $('#pw-gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = $('#gate-pw1').value;
    const p2 = $('#gate-pw2').value;
    const status = $('#gate-status');
    if (p1 !== p2) { status.textContent = 'Those don’t match.'; return; }
    status.textContent = 'Saving…';
    const { error } = await supa.auth.updateUser({
      password: p1,
      data: { must_change_password: false },
    });
    if (error) { status.textContent = error.message; return; }
    root.innerHTML = '';
    toast('Password updated. Welcome aboard.');
  });
}

/* ================= data ================= */

async function loadQuotes() {
  const { data, error } = await supa
    .from('quotes')
    .select('*, quote_items(*), businesses(name)')
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) toast(error.message, 'err');
  state.quotes = data || [];
  return state.quotes;
}

async function loadLeads() {
  const { data, error } = await supa
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) toast(error.message, 'err');
  state.leads = data || [];
  return state.leads;
}

async function loadBusinesses() {
  const { data, error } = await supa
    .from('businesses')
    .select('*, business_members(count), quotes(count)')
    .order('created_at', { ascending: false });
  if (error) toast(error.message, 'err');
  state.bizRows = data || [];
  state.ctx.businesses = state.bizRows;
  return state.bizRows;
}

function quoteRange(q) {
  const items = q.quote_items || [];
  let low = 0, high = 0;
  for (const it of items) {
    const qty = Number(it.qty) || 1;
    low += qty * (Number(it.low) || 0);
    high += qty * (Number(it.high) || 0);
  }
  return [low, high];
}

async function apiPost(path, body) {
  const { data } = await supa.auth.getSession();
  const token = data.session?.access_token || '';
  const res = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}

/* ================= render dispatch ================= */

async function render() {
  main.innerHTML = `<div class="empty" style="margin-top:6vh;"><span class="mono-note">LOADING…</span></div>`;
  try {
    if (state.view === 'dashboard') await viewDashboard();
    else if (state.view === 'inbox') await viewInbox();
    else if (state.view === 'quotes') await viewQuotes();
    else if (state.view === 'leads') await viewLeads();
    else if (state.view === 'clients') await viewClients();
    else if (state.view === 'settings') await viewSettings();
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="empty"><span class="mono-note">SOMETHING BROKE — ${esc(err.message)}</span></div>`;
  }
}

const sampleChip = (row) => (row.is_sample ? '<span class="sample-chip">Sample</span>' : '');

/* ================= dashboard ================= */

async function viewDashboard() {
  const { isOwner, profile } = state.ctx;
  const [quotes] = await Promise.all([
    loadQuotes(),
    isOwner ? loadLeads() : Promise.resolve([]),
  ]);

  const open = quotes.filter((q) => q.status === 'sent');
  const accepted = quotes.filter((q) => q.status === 'accepted');
  const declined = quotes.filter((q) => q.status === 'declined');
  const winRate = accepted.length + declined.length
    ? Math.round((accepted.length / (accepted.length + declined.length)) * 100) + '%'
    : '—';
  const acceptedValue = accepted.reduce((s, q) => s + quoteRange(q)[1], 0);
  const newLeads = state.leads.filter((l) => l.status === 'new').length;

  const { data: acts } = await supa
    .from('activities')
    .select('*, profiles(full_name)')
    .order('created_at', { ascending: false })
    .limit(10);

  const firstName = (profile.full_name || profile.email).split(/[\s@]/)[0];

  main.innerHTML = `
    <div class="view-head">
      <div>
        <p class="eyebrow">01 — Dashboard</p>
        <h2>Hey, ${esc(firstName)}.</h2>
      </div>
      <div class="view-actions">
        <button class="btn btn-fill btn-sm" id="dash-new-quote">+ New quote</button>
      </div>
    </div>

    <div class="stat-grid">
      <div class="stat hot"><span class="k">Open quotes</span><span class="v">${open.length}</span><span class="sub">waiting on a yes</span></div>
      <div class="stat"><span class="k">Accepted</span><span class="v">${accepted.length}</span><span class="sub">${esc(fmtMoney(acceptedValue))} upper-range</span></div>
      <div class="stat"><span class="k">Win rate</span><span class="v">${winRate}</span><span class="sub">accepted vs declined</span></div>
      ${isOwner
        ? `<div class="stat"><span class="k">New leads</span><span class="v">${newLeads}</span><span class="sub">from the website</span></div>`
        : `<div class="stat"><span class="k">Businesses</span><span class="v">${state.ctx.businesses.length}</span><span class="sub">you can quote for</span></div>`}
    </div>

    <div style="display:grid; grid-template-columns: 1.4fr 1fr; gap:16px;" class="dash-cols">
      <div class="panel">
        <div class="panel-head"><span>Recent quotes</span><button class="btn-ghost" id="dash-all-quotes">view all →</button></div>
        ${quotesTable(quotes.slice(0, 6), true)}
      </div>
      <div class="panel">
        <div class="panel-head"><span>Activity</span></div>
        <div style="padding: 6px 18px 14px;">
          ${(acts || []).length ? feedHtml(acts) : `<p class="mono-note" style="padding:20px 0;">NOTHING YET — IT’LL FILL UP AS YOU WORK.</p>`}
        </div>
      </div>
    </div>
    <style>@media (max-width: 1100px){ .dash-cols{ grid-template-columns:1fr !important; } }</style>`;

  $('#dash-new-quote').addEventListener('click', () => { go('quotes'); setTimeout(() => openQuoteDrawer(null), 60); });
  $('#dash-all-quotes').addEventListener('click', () => go('quotes'));
  wireQuoteRows();
}

function feedHtml(acts) {
  return `<div class="feed">${acts
    .map(
      (a) => `
    <div class="feed-item ${a.kind === 'system' ? 'system' : ''}">
      <span class="feed-dot"></span>
      <div>
        <div>${esc(a.body)}</div>
        <div class="when">${a.profiles?.full_name ? esc(a.profiles.full_name.toUpperCase()) + ' · ' : ''}${esc(timeAgo(a.created_at).toUpperCase())}</div>
      </div>
    </div>`
    )
    .join('')}</div>`;
}

/* ================= quotes ================= */

function quotesTable(quotes, compact = false) {
  if (!quotes.length) {
    return `<div class="empty" style="border:none;">
      <span class="mono-note">NO QUOTES YET</span>
      <p style="color:var(--text-2); margin:0;">Write the first one — takes about a minute.</p>
    </div>`;
  }
  return `<div class="tbl-wrap"><table class="tbl">
    <thead><tr>
      <th>Est Nº</th><th>Customer</th><th>Service</th>
      ${state.ctx.isOwner && !compact ? '<th>Business</th>' : ''}
      <th>Range</th><th>Status</th><th>Updated</th>
    </tr></thead>
    <tbody>
      ${quotes
        .map((q) => {
          const [lo, hi] = quoteRange(q);
          return `<tr data-quote="${q.id}">
          <td class="est">Nº ${padEst(q.est_no)}</td>
          <td class="lead-cell">${esc(q.customer_name || '—')}${sampleChip(q)}</td>
          <td class="grow">${esc(q.service || '—')}</td>
          ${state.ctx.isOwner && !compact ? `<td>${esc(q.businesses?.name || '')}</td>` : ''}
          <td class="money">${esc(fmtRange(lo, hi))}</td>
          <td><span class="st ${esc(q.status)}">${esc(q.status)}</span></td>
          <td class="est">${esc(timeAgo(q.updated_at))}</td>
        </tr>`;
        })
        .join('')}
    </tbody>
  </table></div>`;
}

function wireQuoteRows() {
  $$('[data-quote]').forEach((tr) =>
    tr.addEventListener('click', () => {
      const q = state.quotes.find((x) => x.id === tr.dataset.quote);
      if (q) openQuoteDrawer(q);
    })
  );
}

async function viewQuotes() {
  await loadQuotes();
  const f = state.quoteFilter;
  const statuses = ['all', 'draft', 'sent', 'accepted', 'declined', 'expired'];

  const bizName = f.business
    ? state.ctx.businesses.find((b) => b.id === f.business)?.name
    : null;

  main.innerHTML = `
    <div class="view-head">
      <div>
        <p class="eyebrow">03 — Quotes</p>
        <h2>Every estimate, receipted.</h2>
      </div>
      <div class="view-actions">
        <button class="btn btn-fill btn-sm" id="new-quote-btn">+ New quote</button>
      </div>
    </div>

    <div class="toolbar">
      <input class="search" id="quote-search" placeholder="Search customer or service…" value="${esc(f.q)}">
      ${statuses
        .map(
          (s) =>
            `<button class="fchip ${f.status === s ? 'on' : ''}" data-status="${s}">${s}</button>`
        )
        .join('')}
      ${bizName ? `<button class="fchip on" id="clear-biz">✕ ${esc(bizName)}</button>` : ''}
    </div>

    <div class="panel" id="quotes-panel"></div>`;

  const draw = () => {
    let rows = state.quotes;
    if (f.status !== 'all') rows = rows.filter((q) => q.status === f.status);
    if (f.business) rows = rows.filter((q) => q.business_id === f.business);
    if (f.q) {
      const needle = f.q.toLowerCase();
      rows = rows.filter((q) =>
        (q.customer_name + ' ' + q.service + ' ' + (q.businesses?.name || ''))
          .toLowerCase()
          .includes(needle)
      );
    }
    $('#quotes-panel').innerHTML = quotesTable(rows);
    wireQuoteRows();
  };
  draw();

  $('#new-quote-btn').addEventListener('click', () => openQuoteDrawer(null));
  $('#quote-search').addEventListener('input', (e) => { f.q = e.target.value; draw(); });
  $$('.fchip[data-status]').forEach((c) =>
    c.addEventListener('click', () => { f.status = c.dataset.status; viewQuotes(); })
  );
  $('#clear-biz')?.addEventListener('click', () => { f.business = null; viewQuotes(); });
}

/* ---------- quote drawer / editor ---------- */

function openQuoteDrawer(quote) {
  const isNew = !quote;
  const q = quote || {
    customer_name: '', customer_email: '', customer_phone: '',
    service: '', details: '', window_label: '', status: 'draft',
    business_id: state.ctx.businesses[0]?.id || '',
    quote_items: [{ label: '', qty: 1, low: '', high: '' }],
  };

  if (!state.ctx.businesses.length) {
    toast(state.ctx.isOwner
      ? 'Create a client business first (CRM → Clients).'
      : 'No business is linked to your login yet — ask Ethan.', 'err');
    return;
  }

  const bizOptions = state.ctx.businesses
    .map((b) => `<option value="${b.id}" ${b.id === q.business_id ? 'selected' : ''}>${esc(b.name)}</option>`)
    .join('');

  openDrawer(
    isNew ? 'NEW QUOTE' : `EST. Nº ${padEst(q.est_no)}${q.is_sample ? ' · SAMPLE' : ''}`,
    `
    <div class="field">
      <label>Business</label>
      <select id="qf-business" ${state.ctx.businesses.length === 1 ? 'disabled' : ''}>${bizOptions}</select>
    </div>
    <div class="frm-2">
      <div class="field"><label>Customer name</label><input id="qf-name" value="${esc(q.customer_name)}" placeholder="Jordan Alvarez"></div>
      <div class="field"><label>Phone <span class="opt">— optional</span></label><input id="qf-phone" value="${esc(q.customer_phone || '')}" placeholder="(555) 010-2277"></div>
    </div>
    <div class="field"><label>Customer email <span class="opt">— optional</span></label><input id="qf-email" type="email" value="${esc(q.customer_email || '')}" placeholder="customer@email.com"></div>
    <div class="frm-2">
      <div class="field"><label>Service</label><input id="qf-service" value="${esc(q.service)}" placeholder="Deep clean · 3 bd"></div>
      <div class="field"><label>Window</label><input id="qf-window" value="${esc(q.window_label || '')}" placeholder="Friday AM"></div>
    </div>
    <div class="field"><label>Details <span class="opt">— what shapes the price</span></label>
      <textarea id="qf-details" placeholder="~1,800 sq ft, two bathrooms, oven + fridge add-on…">${esc(q.details || '')}</textarea>
    </div>

    <div>
      <label style="display:block; margin-bottom:10px;">Line items</label>
      <div class="items-head"><span>Item</span><span>Qty</span><span>Low $</span><span>High $</span><span></span></div>
      <div class="items-grid" id="qf-items"></div>
      <button class="btn-ghost" id="qf-add-item" style="margin-top:8px;">+ add line item</button>
      <div class="range-line" style="margin-top:14px;">
        <span>Estimate range</span>
        <span class="amount" id="qf-range">$—</span>
      </div>
    </div>

    <div class="field">
      <label>Status</label>
      <select id="qf-status">
        ${['draft', 'sent', 'accepted', 'declined', 'expired']
          .map((s) => `<option ${s === q.status ? 'selected' : ''}>${s}</option>`)
          .join('')}
      </select>
    </div>

    ${!isNew ? `
    <div class="kv">
      <span class="k">Share link — the customer’s receipt</span>
      <div class="copy-box"><code>${esc(shareUrl(q))}</code>
        <button class="x-btn" id="qf-copy" title="Copy link" style="flex-shrink:0;">⧉</button>
      </div>
      <span class="mini-note">ANYONE WITH THE LINK CAN VIEW · ACCEPT / DECLINE SHOWS WHEN STATUS IS “SENT”</span>
    </div>` : ''}

    <div id="qf-preview"></div>
    `,
    `
    <button class="btn btn-fill btn-sm" id="qf-save">${isNew ? 'Create quote' : 'Save changes'}</button>
    ${!isNew && q.status === 'draft' ? '<button class="btn btn-line btn-sm" id="qf-send">Save & mark sent</button>' : ''}
    <button class="btn btn-line btn-sm" id="qf-toggle-preview">Receipt preview</button>
    ${!isNew ? '<button class="btn btn-line btn-sm btn-danger" id="qf-delete" style="margin-left:auto;">Delete</button>' : ''}
    `
  );

  const itemsRoot = $('#qf-items');
  const items = (q.quote_items || [])
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0))
    .map((it) => ({ label: it.label, qty: it.qty, low: it.low, high: it.high }));
  if (!items.length) items.push({ label: '', qty: 1, low: '', high: '' });

  function drawItems() {
    itemsRoot.innerHTML = items
      .map(
        (it, i) => `
      <div class="item-row" data-i="${i}">
        <input data-f="label" value="${esc(it.label)}" placeholder="Deep clean — whole house">
        <input data-f="qty" type="number" min="0" step="1" value="${esc(it.qty)}">
        <input data-f="low" type="number" min="0" step="1" value="${esc(it.low)}" placeholder="220">
        <input data-f="high" type="number" min="0" step="1" value="${esc(it.high)}" placeholder="280">
        <button class="x-btn" data-del="${i}" title="Remove">✕</button>
      </div>`
      )
      .join('');
    itemsRoot.querySelectorAll('input').forEach((inp) =>
      inp.addEventListener('input', () => {
        const row = inp.closest('.item-row');
        items[+row.dataset.i][inp.dataset.f] = inp.value;
        drawRange();
      })
    );
    itemsRoot.querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', () => {
        items.splice(+b.dataset.del, 1);
        if (!items.length) items.push({ label: '', qty: 1, low: '', high: '' });
        drawItems(); drawRange();
      })
    );
    drawRange();
  }

  function currentRange() {
    let lo = 0, hi = 0;
    for (const it of items) {
      const qty = Number(it.qty) || 0;
      lo += qty * (Number(it.low) || 0);
      hi += qty * (Number(it.high) || 0);
    }
    return [lo, hi];
  }

  function drawRange() {
    const [lo, hi] = currentRange();
    $('#qf-range').textContent = fmtRange(lo, hi);
  }

  drawItems();

  $('#qf-add-item').addEventListener('click', () => {
    items.push({ label: '', qty: 1, low: '', high: '' });
    drawItems();
  });

  $('#qf-toggle-preview').addEventListener('click', () => {
    const box = $('#qf-preview');
    if (box.innerHTML) { box.innerHTML = ''; return; }
    const [lo, hi] = currentRange();
    const bizName =
      state.ctx.businesses.find((b) => b.id === $('#qf-business').value)?.name || '';
    box.innerHTML = receiptHtml({
      est_no: q.est_no ?? '—',
      business: bizName,
      customer_name: $('#qf-name').value,
      service: $('#qf-service').value,
      window_label: $('#qf-window').value,
      status: $('#qf-status').value,
      items: items.filter((i) => i.label),
      lo, hi,
    });
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  $('#qf-copy')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(shareUrl(q));
    toast('Share link copied.');
  });

  async function save(statusOverride) {
    const btns = ['#qf-save', '#qf-send'].map((s) => $(s)).filter(Boolean);
    btns.forEach((b) => (b.disabled = true));
    try {
      const fields = {
        business_id: $('#qf-business').value,
        customer_name: $('#qf-name').value.trim(),
        customer_email: $('#qf-email').value.trim(),
        customer_phone: $('#qf-phone').value.trim(),
        service: $('#qf-service').value.trim(),
        window_label: $('#qf-window').value.trim(),
        details: $('#qf-details').value.trim(),
        status: statusOverride || $('#qf-status').value,
      };
      if (!fields.customer_name && !fields.service) {
        throw new Error('Give it at least a customer or a service.');
      }

      let quoteId = q.id;
      if (isNew) {
        const { data, error } = await supa
          .from('quotes')
          .insert({ ...fields, created_by: state.ctx.user.id })
          .select()
          .single();
        if (error) throw error;
        quoteId = data.id;
        q.id = data.id; q.est_no = data.est_no; q.share_token = data.share_token;
      } else {
        const { error } = await supa.from('quotes').update(fields).eq('id', quoteId);
        if (error) throw error;
      }

      // Replace items wholesale — simple and correct at this scale.
      const clean = items
        .filter((i) => String(i.label).trim())
        .map((i, idx) => ({
          quote_id: quoteId,
          label: String(i.label).trim().slice(0, 300),
          qty: Number(i.qty) || 1,
          low: Number(i.low) || 0,
          high: Number(i.high) || 0,
          sort: idx,
        }));
      const { error: delErr } = await supa.from('quote_items').delete().eq('quote_id', quoteId);
      if (delErr) throw delErr;
      if (clean.length) {
        const { error: insErr } = await supa.from('quote_items').insert(clean);
        if (insErr) throw insErr;
      }

      toast(isNew ? `Estimate Nº ${padEst(q.est_no)} created.` : 'Quote saved.');
      closeDrawer();
      await render();
    } catch (err) {
      toast(err.message, 'err');
      btns.forEach((b) => (b.disabled = false));
    }
  }

  $('#qf-save').addEventListener('click', () => save());
  $('#qf-send')?.addEventListener('click', () => save('sent'));

  $('#qf-delete')?.addEventListener('click', async () => {
    if (!confirm(`Delete estimate Nº ${padEst(q.est_no)}? This can’t be undone.`)) return;
    const { error } = await supa.from('quotes').delete().eq('id', q.id);
    if (error) {
      toast(state.ctx.isOwner ? error.message : 'Only draft quotes can be deleted from a client login.', 'err');
      return;
    }
    toast('Quote deleted.');
    closeDrawer();
    await render();
  });
}

function shareUrl(q) {
  return `${location.origin}/q?t=${q.share_token}`;
}

function receiptHtml(r) {
  const stamps = { accepted: 'Accepted', declined: 'Declined', sent: 'Awaiting reply' };
  return `
  <div class="receipt-lg" style="margin-top:6px;">
    ${stamps[r.status] ? `<span class="stamp">${stamps[r.status]}</span>` : ''}
    <div class="rc-head"><span>QUIKQUOTE</span><span>EST. Nº ${esc(padEst(r.est_no))}</span></div>
    <div class="rc-biz">${esc(r.business)}</div>
    ${r.customer_name ? `<div class="rc-row"><span class="k">FOR</span><span class="v">${esc(r.customer_name)}</span></div>` : ''}
    ${r.service ? `<div class="rc-row"><span class="k">SERVICE</span><span class="v">${esc(r.service)}</span></div>` : ''}
    ${r.window_label ? `<div class="rc-row"><span class="k">WINDOW</span><span class="v">${esc(r.window_label)}</span></div>` : ''}
    ${r.items?.length
      ? `<div class="rc-items">${r.items
          .map(
            (i) =>
              `<div class="rc-row"><span class="k">${esc(i.label)}${Number(i.qty) > 1 ? ` ×${esc(i.qty)}` : ''}</span><span class="v">${esc(fmtRange((Number(i.qty) || 1) * (Number(i.low) || 0), (Number(i.qty) || 1) * (Number(i.high) || 0)))}</span></div>`
          )
          .join('')}</div>`
      : ''}
    <div class="rc-total"><span>ESTIMATE</span><span class="amount">${esc(fmtRange(r.lo, r.hi))}</span></div>
    <div class="rc-note">RANGES, NOT PROMISES — FINAL PRICE CONFIRMED BEFORE WORK BEGINS.</div>
  </div>`;
}

/* ================= inbox (SMS + simulator) ================= */

async function loadConvos() {
  const { data, error } = await supa
    .from('conversations')
    .select('*, businesses(name), messages(body, direction, created_at)')
    .order('updated_at', { ascending: false })
    .order('created_at', { foreignTable: 'messages', ascending: false })
    .limit(1, { foreignTable: 'messages' })
    .limit(200);
  if (error) toast(error.message, 'err');
  state.convos = data || [];
  return state.convos;
}

async function viewInbox() {
  await loadConvos();

  main.innerHTML = `
    <div class="view-head">
      <div>
        <p class="eyebrow">02 — Inbox</p>
        <h2>Texts that price themselves.</h2>
      </div>
      <div class="view-actions">
        <button class="btn btn-fill btn-sm" id="new-sim-btn">+ Test the agent</button>
      </div>
    </div>
    <p class="mono-note" style="margin:-14px 0 18px;">CUSTOMERS TEXT THE BUSINESS LINE · THE AGENT SCOPES THE JOB, QUOTES A RANGE, AND FILES THE ESTIMATE HERE.</p>
    <div class="panel">
      ${state.convos.length
        ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>Customer</th><th>Business</th><th>Last message</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>${state.convos
            .map((c) => {
              const last = c.messages?.[0];
              return `<tr data-convo="${c.id}">
              <td class="lead-cell">${esc(c.customer_name || c.customer_phone)}${c.channel === 'simulator' ? '<span class="sample-chip">Sim</span>' : ''}</td>
              <td>${esc(c.businesses?.name || '')}</td>
              <td class="grow" style="max-width:340px; overflow:hidden; text-overflow:ellipsis;">${esc((last?.body || '').slice(0, 90))}</td>
              <td><span class="st c-${esc(c.status)}">${esc(c.status)}</span></td>
              <td class="est">${esc(timeAgo(c.updated_at))}</td>
            </tr>`;
            })
            .join('')}</tbody></table></div>`
        : `<div class="empty" style="border:none;">
            <span class="mono-note">NO CONVERSATIONS YET</span>
            <p style="color:var(--text-2); margin:0;">Hit “Test the agent” to play the customer — or wire a real number to the business line.</p>
          </div>`}
    </div>`;

  $('#new-sim-btn').addEventListener('click', () => {
    if (!state.ctx.businesses.length) {
      toast('Create a client business first.', 'err');
      return;
    }
    openThreadDrawer(null);
  });

  $$('[data-convo]').forEach((tr) =>
    tr.addEventListener('click', () => {
      const c = state.convos.find((x) => x.id === tr.dataset.convo);
      if (c) openThreadDrawer(c);
    })
  );
}

function openThreadDrawer(convo) {
  const businesses = state.ctx.businesses;
  const bizId = convo?.business_id || businesses[0]?.id;
  const phone = convo?.customer_phone ||
    `+1555${String(Math.floor(1000000 + Math.random() * 8999999))}`;

  openDrawer(
    convo
      ? `THREAD · ${(convo.customer_name || convo.customer_phone).toUpperCase()}`
      : 'TEST THE AGENT',
    `
    ${!convo && businesses.length > 1
      ? `<div class="field"><label>Business line</label>
           <select id="th-biz">${businesses.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select></div>`
      : ''}
    <div class="kv">
      <span class="k">${convo ? 'Customer' : 'You are texting as'}</span>
      <span class="v" style="font-family:var(--font-mono); font-size:13.5px;">${esc(phone)}</span>
    </div>
    <div class="thread-wrap" id="th-box">
      ${convo ? '<span class="mono-note">LOADING…</span>' : '<span class="mono-note">SAY SOMETHING LIKE “HOW MUCH FOR A DEEP CLEAN, 3 BED HOUSE?”</span>'}
    </div>
    <div id="th-quote"></div>
    `,
    `
    <div class="composer">
      <input id="th-input" placeholder="Text as the customer…" maxlength="480" autocomplete="off">
      <button class="btn btn-fill btn-sm" id="th-send">Send</button>
    </div>
    `
  );

  let current = convo;

  async function drawThread() {
    if (!current) return;
    const { data: msgs } = await supa
      .from('messages')
      .select('direction, body, created_at')
      .eq('conversation_id', current.id)
      .order('created_at', { ascending: true })
      .limit(60);
    const box = $('#th-box');
    if (!box) return;
    // Same visual language as the landing demo: customer = plain left,
    // the agent = ember right.
    box.innerHTML = (msgs || [])
      .map((m) => `<div class="bubble ${m.direction === 'in' ? 'in' : 'out'}">${esc(m.body)}</div>`)
      .join('') || '<span class="mono-note">EMPTY THREAD</span>';
    box.scrollTop = box.scrollHeight;

    const qbox = $('#th-quote');
    if (qbox && current.quote_id) {
      const q = state.quotes.find((x) => x.id === current.quote_id);
      qbox.innerHTML = `<div class="copy-box"><code>Estimate filed — see it under Quotes${q ? ` (Nº ${padEst(q.est_no)})` : ''}</code>
        <button class="btn btn-line btn-sm" id="th-open-quotes" style="flex-shrink:0;">Open →</button></div>`;
      $('#th-open-quotes')?.addEventListener('click', () => go('quotes'));
    }
  }

  drawThread();

  // Live-ish refresh while the drawer is open (real SMS can land any time).
  if (state.threadTimer) clearInterval(state.threadTimer);
  state.threadTimer = setInterval(async () => {
    if (!document.body.classList.contains('drawer-open')) return;
    if (current) {
      const { data } = await supa.from('conversations').select('*').eq('id', current.id).maybeSingle();
      if (data) current = data;
      drawThread();
    }
  }, 5000);

  async function send() {
    const input = $('#th-input');
    const text = input.value.trim();
    if (!text) return;
    const btn = $('#th-send');
    btn.disabled = true;
    const chosenBiz = $('#th-biz')?.value || bizId;
    try {
      const out = await apiPost('/api/sms', {
        simulate: true,
        business_id: chosenBiz,
        from: phone,
        body: text,
      });
      input.value = '';
      if (!current) {
        const { data } = await supa
          .from('conversations')
          .select('*')
          .eq('business_id', chosenBiz)
          .eq('customer_phone', phone)
          .order('created_at', { ascending: false })
          .limit(1);
        current = data?.[0] || null;
      } else {
        const { data } = await supa.from('conversations').select('*').eq('id', current.id).maybeSingle();
        if (data) current = data;
      }
      if (out.quote) {
        await loadQuotes();
        toast(`Estimate Nº ${padEst(out.quote.est_no)} created from the conversation.`);
      }
      await drawThread();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
      input.focus();
    }
  }

  $('#th-send').addEventListener('click', send);
  $('#th-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });
}

/* ================= leads (owner) ================= */

const LEAD_COLS = ['new', 'contacted', 'qualified', 'converted', 'archived'];

async function viewLeads() {
  await loadLeads();

  main.innerHTML = `
    <div class="view-head">
      <div>
        <p class="eyebrow">04 — Leads</p>
        <h2>People who said hello.</h2>
      </div>
      <div class="view-actions">
        <button class="btn btn-line btn-sm" id="new-lead-btn">+ Add manually</button>
      </div>
    </div>
    <p class="mono-note" style="margin:-14px 0 18px;">THE SITE’S CONTACT FORM FEEDS THIS BOARD AUTOMATICALLY.</p>
    <div class="pipe" id="pipe"></div>`;

  const pipe = $('#pipe');
  pipe.innerHTML = LEAD_COLS.map((col) => {
    const rows = state.leads.filter((l) => l.status === col);
    return `
    <div class="pipe-col">
      <div class="pipe-head"><span>${col}</span><span class="cnt">${rows.length}</span></div>
      ${rows
        .map(
          (l) => `
        <div class="lead-tile" data-lead="${l.id}">
          <span class="who">${esc(l.name || l.email || 'Anonymous')}${sampleChip(l)}</span>
          ${l.business ? `<span class="biz">${esc(l.business)}</span>` : ''}
          ${l.message ? `<span class="snip">${esc(l.message)}</span>` : ''}
          <span class="when">${esc(timeAgo(l.created_at).toUpperCase())} · ${esc(l.source.toUpperCase())}</span>
        </div>`
        )
        .join('') || `<p class="mono-note" style="padding:8px 4px;">EMPTY</p>`}
    </div>`;
  }).join('');

  $$('[data-lead]').forEach((tile) =>
    tile.addEventListener('click', () => {
      const lead = state.leads.find((l) => l.id === tile.dataset.lead);
      if (lead) openLeadDrawer(lead);
    })
  );

  $('#new-lead-btn').addEventListener('click', () => openLeadDrawer(null));
}

function openLeadDrawer(lead) {
  const isNew = !lead;
  const l = lead || { name: '', email: '', business: '', message: '', status: 'new' };

  openDrawer(
    isNew ? 'ADD LEAD' : `LEAD · ${(l.name || l.email || '?').toUpperCase()}`,
    `
    <div class="frm-2">
      <div class="field"><label>Name</label><input id="lf-name" value="${esc(l.name)}"></div>
      <div class="field"><label>Email</label><input id="lf-email" type="email" value="${esc(l.email)}"></div>
    </div>
    <div class="field"><label>Business</label><input id="lf-biz" value="${esc(l.business)}" placeholder="e.g. a cleaning company in Austin"></div>
    <div class="field"><label>Message / context</label><textarea id="lf-msg">${esc(l.message)}</textarea></div>
    <div class="field"><label>Status</label>
      <select id="lf-status">${LEAD_COLS.map((s) => `<option ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
    </div>
    ${!isNew && l.email ? `
      <a class="btn btn-line btn-sm" href="mailto:${esc(l.email)}?subject=${encodeURIComponent('Re: QuikQuoteAI')}">Reply by email →</a>` : ''}
    ${!isNew ? `<div><label style="display:block;margin-bottom:10px;">Notes</label><div id="lf-feed"></div>
      <div style="display:grid; gap:8px; margin-top:10px;">
        <textarea id="lf-note" placeholder="Called them back, sounded keen…" style="min-height:70px;"></textarea>
        <button class="btn btn-line btn-sm" id="lf-add-note" style="justify-self:start;">Add note</button>
      </div></div>` : ''}
    `,
    `
    <button class="btn btn-fill btn-sm" id="lf-save">${isNew ? 'Add lead' : 'Save'}</button>
    ${!isNew && l.status !== 'converted' ? '<button class="btn btn-line btn-sm" id="lf-convert">Convert to client →</button>' : ''}
    `
  );

  if (!isNew) loadLeadNotes(l);

  $('#lf-save').addEventListener('click', async () => {
    const fields = {
      name: $('#lf-name').value.trim(),
      email: $('#lf-email').value.trim(),
      business: $('#lf-biz').value.trim(),
      message: $('#lf-msg').value.trim(),
      status: $('#lf-status').value,
    };
    const { error } = isNew
      ? await supa.from('leads').insert({ ...fields, source: 'manual' })
      : await supa.from('leads').update(fields).eq('id', l.id);
    if (error) return toast(error.message, 'err');
    toast(isNew ? 'Lead added.' : 'Lead saved.');
    closeDrawer();
    render();
  });

  $('#lf-add-note')?.addEventListener('click', async () => {
    const body = $('#lf-note').value.trim();
    if (!body) return;
    const { error } = await supa.from('activities').insert({
      lead_id: l.id, author: state.ctx.user.id, kind: 'note', body,
    });
    if (error) return toast(error.message, 'err');
    $('#lf-note').value = '';
    loadLeadNotes(l);
  });

  $('#lf-convert')?.addEventListener('click', async () => {
    try {
      const { data: biz, error } = await supa
        .from('businesses')
        .insert({
          name: $('#lf-biz').value.trim() || $('#lf-name').value.trim() || 'New client',
          contact_name: $('#lf-name').value.trim(),
          contact_email: $('#lf-email').value.trim(),
          status: 'onboarding',
          notes: $('#lf-msg').value.trim(),
        })
        .select()
        .single();
      if (error) throw error;
      await supa.from('leads').update({ status: 'converted', converted_business_id: biz.id }).eq('id', l.id);
      await supa.from('activities').insert({
        business_id: biz.id, author: state.ctx.user.id, kind: 'system',
        body: `Converted from a ${l.source} lead.`,
      });
      toast(`${biz.name} is now a client business.`);
      closeDrawer();
      go('clients');
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

async function loadLeadNotes(l) {
  const { data } = await supa
    .from('activities')
    .select('*, profiles(full_name)')
    .eq('lead_id', l.id)
    .order('created_at', { ascending: false })
    .limit(30);
  const box = $('#lf-feed');
  if (box) box.innerHTML = data?.length ? feedHtml(data) : '<p class="mono-note">NO NOTES YET.</p>';
}

/* ================= clients (owner) ================= */

async function viewClients() {
  await loadBusinesses();

  main.innerHTML = `
    <div class="view-head">
      <div>
        <p class="eyebrow">05 — Clients</p>
        <h2>The businesses on board.</h2>
      </div>
      <div class="view-actions">
        <button class="btn btn-fill btn-sm" id="new-biz-btn">+ New business</button>
      </div>
    </div>
    <div class="panel">
      ${state.bizRows.length
        ? `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Business</th><th>Industry</th><th>Status</th><th>Logins</th><th>Quotes</th><th>Added</th></tr></thead>
        <tbody>${state.bizRows
          .map(
            (b) => `<tr data-biz="${b.id}">
            <td class="lead-cell">${esc(b.name)}${sampleChip(b)}</td>
            <td class="grow">${esc(b.industry || '—')}</td>
            <td><span class="st ${esc(b.status)}">${esc(b.status)}</span></td>
            <td class="est">${b.business_members?.[0]?.count ?? 0}</td>
            <td class="est">${b.quotes?.[0]?.count ?? 0}</td>
            <td class="est">${esc(timeAgo(b.created_at))}</td>
          </tr>`
          )
          .join('')}</tbody></table></div>`
        : `<div class="empty" style="border:none;">
            <span class="mono-note">NO CLIENT BUSINESSES YET</span>
            <p style="color:var(--text-2); margin:0;">Convert a lead, or add one by hand. Then grant them a portal login.</p>
          </div>`}
    </div>`;

  $('#new-biz-btn').addEventListener('click', () => openBizDrawer(null));
  $$('[data-biz]').forEach((tr) =>
    tr.addEventListener('click', () => {
      const b = state.bizRows.find((x) => x.id === tr.dataset.biz);
      if (b) openBizDrawer(b);
    })
  );
}

function openBizDrawer(biz) {
  const isNew = !biz;
  const b = biz || {
    name: '', industry: '', contact_name: '', contact_email: '',
    phone: '', status: 'onboarding', notes: '', phone_line: '', price_book: '',
  };

  openDrawer(
    isNew ? 'NEW BUSINESS' : `CLIENT · ${b.name.toUpperCase()}`,
    `
    <div class="field"><label>Business name</label><input id="bf-name" value="${esc(b.name)}" placeholder="Brightside Cleaning Co."></div>
    <div class="frm-2">
      <div class="field"><label>Industry</label><input id="bf-industry" value="${esc(b.industry)}" placeholder="Home cleaning"></div>
      <div class="field"><label>Status</label>
        <select id="bf-status">${['lead', 'onboarding', 'active', 'paused']
          .map((s) => `<option ${s === b.status ? 'selected' : ''}>${s}</option>`)
          .join('')}</select>
      </div>
    </div>
    <div class="frm-2">
      <div class="field"><label>Contact name</label><input id="bf-contact" value="${esc(b.contact_name)}"></div>
      <div class="field"><label>Contact email</label><input id="bf-email" type="email" value="${esc(b.contact_email)}"></div>
    </div>
    <div class="field"><label>Phone</label><input id="bf-phone" value="${esc(b.phone)}"></div>
    <div class="field"><label>Notes</label><textarea id="bf-notes">${esc(b.notes)}</textarea></div>

    <div>
      <label style="display:block; margin-bottom:4px;">Text-to-quote line</label>
      <p class="mini-note" style="margin-bottom:10px;">THE NUMBER YOU PROVIDE THIS BUSINESS. TEXTS TO IT HIT THE ESTIMATING AGENT — POINT THE PROVIDER'S SMS WEBHOOK AT /api/sms.</p>
      <div class="field"><input id="bf-line" value="${esc(b.phone_line || '')}" placeholder="+15551234567" style="font-family:var(--font-mono);"></div>
      <div class="field" style="margin-top:12px;">
        <label>Price book <span class="opt">— one per line: Service: low-high</span></label>
        <textarea id="bf-book" style="font-family:var(--font-mono); font-size:12.5px; min-height:110px;" placeholder="Deep clean · 2bd: 190-250&#10;Deep clean · 3bd: 240-320&#10;Standard clean · 2bd: 130-180">${esc(b.price_book || '')}</textarea>
      </div>
      <p class="mini-note" style="margin-top:8px;">THE AGENT ONLY QUOTES RANGES FROM THIS LIST — NO PRICE BOOK, NO NUMBERS.</p>
    </div>

    ${!isNew ? `
    <div>
      <label style="display:block; margin-bottom:4px;">Portal access</label>
      <p class="mini-note" style="margin-bottom:10px;">LOGINS SEE ONLY THIS BUSINESS’S QUOTES — ROW-LEVEL SECURITY DOES THE FENCING.</p>
      <div id="bf-members"><p class="mono-note">LOADING…</p></div>
      <div class="frm-2" style="margin-top:12px;">
        <input id="bf-invite-email" type="email" placeholder="client@business.com">
        <input id="bf-invite-name" placeholder="Their name">
      </div>
      <button class="btn btn-line btn-sm" id="bf-invite" style="margin-top:10px;">Grant access →</button>
      <div id="bf-invite-result" style="margin-top:10px;"></div>
    </div>

    <div>
      <label style="display:block; margin-bottom:10px;">Timeline</label>
      <div id="bf-feed"><p class="mono-note">LOADING…</p></div>
      <div style="display:grid; gap:8px; margin-top:10px;">
        <textarea id="bf-note" placeholder="Kickoff call went well…" style="min-height:70px;"></textarea>
        <button class="btn btn-line btn-sm" id="bf-add-note" style="justify-self:start;">Add note</button>
      </div>
    </div>` : ''}
    `,
    `
    <button class="btn btn-fill btn-sm" id="bf-save">${isNew ? 'Create business' : 'Save changes'}</button>
    ${!isNew ? `<button class="btn btn-line btn-sm" id="bf-quotes">View quotes →</button>` : ''}
    `
  );

  if (!isNew) {
    loadMembers(b);
    loadBizFeed(b);
  }

  $('#bf-save').addEventListener('click', async () => {
    const fields = {
      name: $('#bf-name').value.trim(),
      industry: $('#bf-industry').value.trim(),
      status: $('#bf-status').value,
      contact_name: $('#bf-contact').value.trim(),
      contact_email: $('#bf-email').value.trim(),
      phone: $('#bf-phone').value.trim(),
      notes: $('#bf-notes').value.trim(),
      phone_line: $('#bf-line').value.replace(/[^\d+]/g, ''),
      price_book: $('#bf-book').value.trim(),
    };
    if (!fields.name) return toast('The business needs a name.', 'err');
    const { error } = isNew
      ? await supa.from('businesses').insert(fields)
      : await supa.from('businesses').update(fields).eq('id', b.id);
    if (error) return toast(error.message, 'err');
    toast(isNew ? 'Business created.' : 'Saved.');
    closeDrawer();
    render();
  });

  $('#bf-quotes')?.addEventListener('click', () => {
    state.quoteFilter.business = b.id;
    state.quoteFilter.status = 'all';
    closeDrawer();
    go('quotes');
  });

  $('#bf-invite')?.addEventListener('click', async () => {
    const email = $('#bf-invite-email').value.trim();
    const fullName = $('#bf-invite-name').value.trim();
    const btn = $('#bf-invite');
    if (!email) return toast('Email required.', 'err');
    btn.disabled = true;
    try {
      const out = await apiPost('/api/admin', {
        action: 'create_client', email, full_name: fullName, business_id: b.id,
      });
      $('#bf-invite-result').innerHTML = out.temp_password
        ? `<div class="kv"><span class="k">Temporary password — share it with them once</span>
             <div class="copy-box"><code>${esc(out.temp_password)}</code>
               <button class="x-btn" id="bf-copy-pw" style="flex-shrink:0;" title="Copy">⧉</button></div>
             <span class="mini-note">THEY’LL BE ASKED TO PICK THEIR OWN ON FIRST SIGN-IN.</span></div>`
        : `<p class="mono-note">THAT LOGIN ALREADY EXISTED — IT NOW HAS ACCESS TO ${esc(b.name.toUpperCase())}.</p>`;
      $('#bf-copy-pw')?.addEventListener('click', async () => {
        await navigator.clipboard.writeText(out.temp_password);
        toast('Password copied.');
      });
      $('#bf-invite-email').value = '';
      $('#bf-invite-name').value = '';
      loadMembers(b);
      toast('Access granted.');
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  $('#bf-add-note')?.addEventListener('click', async () => {
    const body = $('#bf-note').value.trim();
    if (!body) return;
    const { error } = await supa.from('activities').insert({
      business_id: b.id, author: state.ctx.user.id, kind: 'note', body,
    });
    if (error) return toast(error.message, 'err');
    $('#bf-note').value = '';
    loadBizFeed(b);
  });
}

async function loadMembers(b) {
  const { data } = await supa
    .from('business_members')
    .select('user_id, created_at, profiles(full_name, email)')
    .eq('business_id', b.id);
  const box = $('#bf-members');
  if (!box) return;
  if (!data?.length) {
    box.innerHTML = '<p class="mono-note">NO LOGINS YET — GRANT THE FIRST ONE BELOW.</p>';
    return;
  }
  box.innerHTML = data
    .map(
      (m) => `
    <div class="member-row">
      <div>
        <div class="m-name">${esc(m.profiles?.full_name || '—')}</div>
        <div class="m-email">${esc(m.profiles?.email || m.user_id)}</div>
      </div>
      <div class="m-actions">
        <button class="btn btn-line btn-sm" data-reset="${m.user_id}">Reset password</button>
        <button class="btn btn-line btn-sm btn-danger" data-revoke="${m.user_id}">Revoke</button>
      </div>
    </div>`
    )
    .join('');

  box.querySelectorAll('[data-reset]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const out = await apiPost('/api/admin', {
          action: 'reset_password', user_id: btn.dataset.reset,
        });
        $('#bf-invite-result').innerHTML = `<div class="kv">
          <span class="k">New temporary password</span>
          <div class="copy-box"><code>${esc(out.temp_password)}</code></div>
          <span class="mini-note">SHARE IT ONCE — THEY’LL SET THEIR OWN AT NEXT SIGN-IN.</span></div>`;
        toast('Password reset.');
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    })
  );

  box.querySelectorAll('[data-revoke]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Revoke this login’s access to the business?')) return;
      try {
        await apiPost('/api/admin', {
          action: 'revoke_access', user_id: btn.dataset.revoke, business_id: b.id,
        });
        toast('Access revoked.');
        loadMembers(b);
      } catch (err) {
        toast(err.message, 'err');
      }
    })
  );
}

async function loadBizFeed(b) {
  const { data } = await supa
    .from('activities')
    .select('*, profiles(full_name)')
    .eq('business_id', b.id)
    .order('created_at', { ascending: false })
    .limit(30);
  const box = $('#bf-feed');
  if (box) box.innerHTML = data?.length ? feedHtml(data) : '<p class="mono-note">QUIET SO FAR.</p>';
}

/* ================= settings ================= */

async function viewSettings() {
  const { profile, isOwner, user } = state.ctx;

  main.innerHTML = `
    <div class="view-head">
      <div>
        <p class="eyebrow">06 — Settings</p>
        <h2>Your corner of it.</h2>
      </div>
    </div>

    <div style="display:grid; gap:16px; max-width:560px;">
      <div class="panel" style="padding:22px;">
        <div class="kv" style="margin-bottom:16px;"><span class="k">Signed in as</span>
          <span class="v">${esc(profile.email)} · <span class="ws-role">${isOwner ? 'owner' : 'client'}</span></span></div>
        <div class="field">
          <label>Display name</label>
          <input id="set-name" value="${esc(profile.full_name || '')}" placeholder="Your name">
        </div>
        <button class="btn btn-line btn-sm" id="set-save-name" style="margin-top:12px;">Save name</button>
      </div>

      <div class="panel" style="padding:22px;">
        <label style="display:block; margin-bottom:12px;">Change password</label>
        <div class="frm-2">
          <input id="set-pw1" type="password" autocomplete="new-password" minlength="8" placeholder="New password">
          <input id="set-pw2" type="password" autocomplete="new-password" minlength="8" placeholder="Repeat it">
        </div>
        <button class="btn btn-line btn-sm" id="set-save-pw" style="margin-top:12px;">Update password</button>
      </div>

      ${isOwner ? `
      <div class="panel" style="padding:22px;">
        <label style="display:block; margin-bottom:6px;">Sample data</label>
        <p class="mini-note" style="margin-bottom:12px;">THE CLEARLY-LABELLED “SAMPLE” ROWS SEEDED AT SETUP. REMOVE THEM WHENEVER.</p>
        <button class="btn btn-line btn-sm btn-danger" id="set-clear-samples">Clear sample data</button>
      </div>` : ''}

      <button class="btn btn-line btn-sm" id="set-signout" style="justify-self:start;">Sign out</button>
    </div>`;

  $('#set-save-name').addEventListener('click', async () => {
    const full_name = $('#set-name').value.trim();
    const { error } = await supa.from('profiles').update({ full_name }).eq('user_id', user.id);
    if (error) return toast(error.message, 'err');
    await supa.auth.updateUser({ data: { full_name } });
    state.ctx.profile.full_name = full_name;
    paintChrome();
    toast('Name saved.');
  });

  $('#set-save-pw').addEventListener('click', async () => {
    const p1 = $('#set-pw1').value, p2 = $('#set-pw2').value;
    if (p1.length < 8) return toast('Use at least 8 characters.', 'err');
    if (p1 !== p2) return toast('Passwords don’t match.', 'err');
    const { error } = await supa.auth.updateUser({ password: p1, data: { must_change_password: false } });
    if (error) return toast(error.message, 'err');
    $('#set-pw1').value = ''; $('#set-pw2').value = '';
    toast('Password updated.');
  });

  $('#set-clear-samples')?.addEventListener('click', async () => {
    if (!confirm('Remove all rows marked as sample data?')) return;
    try {
      await apiPost('/api/admin', { action: 'clear_samples' });
      toast('Sample data cleared.');
      render();
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  $('#set-signout').addEventListener('click', signOut);
}

/* ================= drawer plumbing ================= */

function openDrawer(title, bodyHtml, footHtml) {
  $('#drawer-title').textContent = title;
  $('#drawer-body').innerHTML = bodyHtml;
  $('#drawer-foot').innerHTML = footHtml || '';
  document.body.classList.add('drawer-open');
}

function closeDrawer() {
  document.body.classList.remove('drawer-open');
  if (state.threadTimer) {
    clearInterval(state.threadTimer);
    state.threadTimer = null;
  }
}

$('#drawer-close').addEventListener('click', closeDrawer);
$('#drawer-backdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

boot();
