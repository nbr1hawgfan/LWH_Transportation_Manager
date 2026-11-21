/* Needs attention — the panel at the top of Home (v1.3.0).
   One look tells a manager what is waiting: driver messages, PODs not reviewed, site note
   suggestions to approve, drivers who can't sign in yet, unpaid time off to approve.
   Each card opens the exact place to handle it. Counts come from tm_attention() in Supabase
   (same Driver Messages sign-in) plus the Time Off count this app already loads. */
window.TMAttention = (function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const API = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  let a = null, timeoff = null, state = 'loading';

  async function refresh() {
    const t = (() => { try { return localStorage.getItem('lwhdispatch_token') || ''; } catch (e) { return ''; } })();
    if (!t) { a = null; state = 'signin'; if (window.TMGate && TMGate.signedIn()) TMGate.check(); return render(); }
    try {
      const r = await fetch(API + 'tm_attention', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: t }), cache: 'no-store' });
      const j = await r.json();
      if (j && j.ok) { a = j; state = 'ok'; }
      else { a = null; state = j && j.error === 'not_manager' ? 'notmgr' : 'signin'; if (window.TMGate && TMGate.signedIn()) TMGate.check(); }
    } catch (e) { state = a ? 'ok' : 'offline'; }
    render();
  }
  function setTimeoff(n) { timeoff = n; render(); }

  function render() {
    const box = $('hubAttn'); if (!box) return;
    const cards = [];
    if (timeoff) cards.push({ n: timeoff, t: 'unpaid time off to approve', lv: 'warn', go: 'timeoff' });
    if (a) {
      if (a.msgs_unread) cards.push({ n: a.msgs_unread, t: 'unread driver messages', lv: 'bad', tab: 'inbox' });
      else if (a.msgs_open) cards.push({ n: a.msgs_open, t: 'driver messages not marked handled', lv: 'info', tab: 'inbox' });
      if (a.tc_review) cards.push({ n: a.tc_review, t: 'time clock days to fix', sub: 'Missing clock-in/out or over 14 hrs. Fix before approving payroll.', lv: 'bad', tab: 'clock' });
      if (a.pods_unreviewed) cards.push({ n: a.pods_unreviewed, t: 'PODs not reviewed', lv: 'warn', tab: 'pods' });
      if (a.sites_pending) cards.push({ n: a.sites_pending, t: 'site note suggestions to approve', lv: 'warn', tab: 'sites' });
      if (a.no_pin) cards.push({ n: a.no_pin, t: "drivers who can't sign in yet", sub: 'No PTO PIN and no Toolkit PIN', lv: 'info', tab: 'pins' });
    }
    let html = cards.map(c => `<button type="button" class="att-card att-${c.lv}" ${c.tab ? `data-att-tab="${c.tab}"` : `data-att-go="${c.go}"`}>
        <b>${esc(c.n)}</b><span class="att-t">${esc(c.t)}</span>${c.sub ? `<span class="att-s">${esc(c.sub)}</span>` : ''}</button>`).join('');
    if (state === 'signin') html += `<button type="button" class="att-card att-signin" data-att-tab="inbox"><span class="att-t">Sign in to Driver Messages</span><span class="att-s">to see driver messages, PODs, site notes and driver sign-in here</span></button>`;
    else if (state === 'offline') html += `<div class="att-note">Couldn't check — no connection.</div>`;
    else if (state === 'ok' && !cards.length) html = `<div class="att-good">✓ Nothing waiting on you right now.</div>`;
    else if (state === 'loading') html += `<div class="att-note">Checking…</div>`;
    box.innerHTML = html;
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-att-tab],[data-att-go]'); if (!b) return;
    if (b.dataset.attGo) return TMApp.open(b.dataset.attGo);
    TMDriverMsgs.tab(b.dataset.attTab);
    TMApp.setNavTab(b.dataset.attTab);
    TMApp.open('messages');
  });
  // The Message Center tells us when the manager reads, reviews or signs in — refresh soon after.
  window.addEventListener('message', e => { if (e.origin === location.origin && e.data && e.data.lwhmc) { clearTimeout(window.__attT); window.__attT = setTimeout(refresh, 1500); } });
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);

  return { refresh, setTimeoff };
})();
