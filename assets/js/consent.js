/* ============================================================
   QuikQuote — cookie consent
   Two surfaces over one store: the corner notice and the
   preferences dialog. Anything that needs to know what the
   visitor agreed to reads QQConsent.get() or subscribes with
   QQConsent.onChange(fn) — nothing gates itself on its own.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'qq.consent';
  var VERSION = 1;

  /* Both off out of the box. Neither is wired to anything yet — they exist so
     nothing can quietly switch itself on the day we add a tag. */
  var CATEGORIES = [
    {
      id: 'analytics',
      name: 'Analytics',
      desc: 'Anonymous counts of which pages get read and which get skipped. Nothing that identifies you.'
    },
    {
      id: 'marketing',
      name: 'Marketing',
      desc: 'Would let an ad platform tell whether a click turned into an enquiry. Nothing here today.'
    }
  ];

  var listeners = [];
  var banner = null;
  var modal = null;
  var panel = null;
  var lastFocus = null;

  /* ---------- store ---------- */

  function read() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      var saved = JSON.parse(raw);
      return saved && saved.v === VERSION ? saved : null;
    } catch (err) {
      return null; // private mode, blocked storage — treat as undecided
    }
  }

  function current() {
    var saved = read();
    var state = { essential: true, decided: !!saved, ts: saved ? saved.ts : null };
    CATEGORIES.forEach(function (cat) {
      state[cat.id] = saved ? !!saved[cat.id] : false;
    });
    return state;
  }

  function decide(choice) {
    var record = { v: VERSION, ts: new Date().toISOString(), essential: true };
    CATEGORIES.forEach(function (cat) { record[cat.id] = !!choice[cat.id]; });
    try { window.localStorage.setItem(KEY, JSON.stringify(record)); } catch (err) {}

    hideBanner();
    closeModal();

    var state = current();
    listeners.forEach(function (fn) { try { fn(state); } catch (err) {} });
    document.dispatchEvent(new CustomEvent('qq:consent', { detail: state }));
  }

  function allOn() {
    var choice = {};
    CATEGORIES.forEach(function (cat) { choice[cat.id] = true; });
    return choice;
  }

  /* ---------- markup ---------- */

  function fromHTML(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  function buildBanner() {
    return fromHTML(
      '<aside class="consent" id="qq-consent" role="region" aria-labelledby="qq-consent-title" hidden>' +
        '<div class="consent-head"><span class="mono">Notice — Cookies</span><span class="consent-hr"></span></div>' +
        '<h2 class="consent-title" id="qq-consent-title">A note on <em>cookies.</em></h2>' +
        '<p class="consent-copy">This site keeps one thing on your device: your answer to this. No analytics and no ad trackers are running today — and if we ever add them, they stay off until you switch them on.</p>' +
        '<div class="consent-actions">' +
          '<button class="btn btn-sm btn-solid" type="button" data-consent="accept"><span>Accept all</span></button>' +
          '<button class="btn btn-sm" type="button" data-consent="essential"><span>Essential only</span></button>' +
        '</div>' +
        '<button class="ulink consent-more" type="button" data-consent="open">Choose what\'s on <span aria-hidden="true">→</span></button>' +
      '</aside>'
    );
  }

  function buildRows() {
    var rows =
      '<li class="consent-row">' +
        '<div class="consent-row-text">' +
          '<p class="consent-row-name">Essential</p>' +
          '<p class="consent-row-desc">Remembers this choice and keeps the quote form working. Without it the site can\'t do its job, so it can\'t be turned off.</p>' +
        '</div>' +
        '<span class="consent-lock mono">Always on</span>' +
      '</li>';

    CATEGORIES.forEach(function (cat) {
      rows +=
        '<li class="consent-row">' +
          '<div class="consent-row-text">' +
            '<p class="consent-row-name">' + cat.name + '</p>' +
            '<p class="consent-row-desc">' + cat.desc + '</p>' +
          '</div>' +
          '<label class="consent-switch">' +
            '<input type="checkbox" data-consent-cat="' + cat.id + '" aria-label="' + cat.name + ' cookies">' +
            '<span class="consent-track" aria-hidden="true"></span>' +
            '<span class="consent-state mono" aria-hidden="true">Off</span>' +
          '</label>' +
        '</li>';
    });

    return rows;
  }

  function buildModal() {
    return fromHTML(
      '<div class="consent-modal" id="qq-consent-modal" hidden>' +
        '<div class="consent-backdrop" data-consent="close"></div>' +
        '<div class="consent-panel" role="dialog" aria-modal="true" aria-labelledby="qq-prefs-title" tabindex="-1">' +
          '<button class="consent-close" type="button" data-consent="close" aria-label="Close cookie preferences">' +
            '<span aria-hidden="true">×</span>' +
          '</button>' +
          '<div class="consent-head"><span class="mono">Preferences — Cookies</span><span class="consent-hr"></span></div>' +
          '<h2 class="consent-title" id="qq-prefs-title">Choose what\'s <em>on.</em></h2>' +
          '<p class="consent-copy">Both switches are off out of the box. Essential is the only thing this site uses today — the others are here so nothing can quietly turn itself on later.</p>' +
          '<ul class="consent-rows">' + buildRows() + '</ul>' +
          '<div class="consent-actions">' +
            '<button class="btn btn-sm btn-solid" type="button" data-consent="save"><span>Save choices</span></button>' +
            '<button class="btn btn-sm" type="button" data-consent="accept"><span>Accept all</span></button>' +
          '</div>' +
          '<p class="consent-foot mono">Kept on this device only · <a href="privacy.html#cookies">Privacy &amp; cookies</a></p>' +
        '</div>' +
      '</div>'
    );
  }

  /* ---------- surfaces ---------- */

  /* Flip the transition class once the browser has painted the closed state.
     rAF alone stalls in a background tab, so a timer backstops it. */
  function afterPaint(fn) {
    var done = false;
    function run() {
      if (done) return;
      done = true;
      fn();
    }
    requestAnimationFrame(function () { requestAnimationFrame(run); });
    window.setTimeout(run, 60);
  }

  function showBanner() {
    if (!banner || !banner.hidden) return;
    banner.hidden = false;
    afterPaint(function () { banner.classList.add('is-in'); });
  }

  function hideBanner() {
    if (!banner || banner.hidden) return;
    banner.classList.remove('is-in');
    window.setTimeout(function () { banner.hidden = true; }, 520);
  }

  function syncSwitches() {
    var state = current();
    modal.querySelectorAll('[data-consent-cat]').forEach(function (input) {
      input.checked = !!state[input.getAttribute('data-consent-cat')];
      paintSwitch(input);
    });
  }

  function paintSwitch(input) {
    var label = input.closest('.consent-switch').querySelector('.consent-state');
    if (label) label.textContent = input.checked ? 'On' : 'Off';
  }

  function openModal() {
    if (!modal || !modal.hidden) return;
    syncSwitches();
    lastFocus = document.activeElement;
    hideBanner();
    modal.hidden = false;
    document.body.classList.add('consent-open');
    afterPaint(function () {
      modal.classList.add('is-in');
      panel.focus();
    });
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.classList.remove('is-in');
    document.body.classList.remove('consent-open');
    window.setTimeout(function () { modal.hidden = true; }, 420);
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
    // Backed out without answering — the notice comes back rather than vanishing.
    if (!current().decided) showBanner();
  }

  function readSwitches() {
    var choice = {};
    modal.querySelectorAll('[data-consent-cat]').forEach(function (input) {
      choice[input.getAttribute('data-consent-cat')] = input.checked;
    });
    return choice;
  }

  /* ---------- wiring ---------- */

  function trapTab(event) {
    if (event.key !== 'Tab') return;
    var focusable = panel.querySelectorAll('button, [href], input, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onAction(event) {
    var trigger = event.target.closest('[data-consent], [data-consent-open], a[href="#cookie-settings"]');
    if (!trigger) return;

    var action = trigger.getAttribute('data-consent');
    if (!action) action = 'open'; // footer links and anything tagged data-consent-open

    if (action === 'open') event.preventDefault();

    if (action === 'accept') decide(allOn());
    else if (action === 'essential') decide({});
    else if (action === 'save') decide(readSwitches());
    else if (action === 'open') openModal();
    else if (action === 'close') closeModal();
  }

  function init() {
    banner = buildBanner();
    modal = buildModal();
    document.body.appendChild(banner);
    document.body.appendChild(modal);
    panel = modal.querySelector('.consent-panel');

    document.addEventListener('click', onAction);
    modal.addEventListener('keydown', trapTab);
    modal.addEventListener('change', function (event) {
      if (event.target.matches('[data-consent-cat]')) paintSwitch(event.target);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !modal.hidden) closeModal();
    });

    // Let the page land first — the notice arrives a beat later, not on top of the hero.
    if (!current().decided) window.setTimeout(showBanner, 900);

    window.QQConsent = {
      get: current,
      set: function (choice) { decide(choice || {}); },
      open: openModal,
      /* Called immediately with the current state, then on every later change. */
      onChange: function (fn) {
        if (typeof fn !== 'function') return;
        listeners.push(fn);
        fn(current());
      },
      /* Clears the stored answer and brings the notice back — handy for testing. */
      reset: function () {
        try { window.localStorage.removeItem(KEY); } catch (err) {}
        showBanner();
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
