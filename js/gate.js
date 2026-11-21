/* Front door (v2.2.0) — one sign-in for Transportation Manager.
   Pick your name (only people set as Manager in the Drivers list) and type your PTO / time off PIN.
   You stay signed in on this device until you tap Sign out (the sign-in renews itself as you use the app).
   It is the same sign-in as Driver Messages, so Messages, Drivers, Driver Hours, Time Clock, Time Clock
   Cards and Needs attention all open without asking again.
   A manager with no PTO PIN uses a one-time setup code (Driver Messages > Driver Sign-in lists them). */
window.TMGate = (function () {
  'use strict';
  const API = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const TK = 'lwhdispatch_token';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const ls = {
    get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
  };
  const rpc = (fn, body) => fetch(API + fn, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), cache: 'no-store' })
    .then(r => r.json());
  let me = null, mgrs = [], pick = null, busy = false;

  /* ---------- states ---------- */
  function lock() {
    me = null; document.body.classList.add('gated'); $('tmGate').hidden = false; who();
    showPick();
  }
  function unlock(m) {
    me = m; ls.set('tm_me', JSON.stringify(m));
    document.body.classList.remove('gated'); $('tmGate').hidden = true; who();
    if (window.TMApp) { TMApp.refreshHub(); }
  }
  function who() {
    document.querySelectorAll('[data-tm-who]').forEach(e => { e.textContent = me ? me.name : ''; });
    document.querySelectorAll('.tm-who').forEach(e => { e.hidden = !me; });
  }

  async function check() {
    const t = ls.get(TK);
    if (!t) return lock();
    try {
      const r = await rpc('drv_me', { p_token: t });
      if (r && r.ok && r.role === 'Manager') return unlock({ id: r.driver_id, name: r.name });
      if (r && r.ok) { msgAfter = 'Transportation Manager is for managers.'; }
      ls.set(TK, null); lock();
    } catch (e) {
      // no connection: don't lock people out of what's already on screen
      let saved = null; try { saved = JSON.parse(ls.get('tm_me') || 'null'); } catch (x) {}
      if (saved) unlock(saved); else lock();
    }
  }
  let msgAfter = '';

  /* ---------- screens ---------- */
  async function showPick() {
    pick = null;
    $('gBody').innerHTML = '<p class="g-muted">Loading…</p>';
    try { mgrs = await rpc('tm_managers'); } catch (e) { mgrs = null; }
    if (!Array.isArray(mgrs)) { $('gBody').innerHTML = '<p class="g-err">Can\'t reach the server. Check the connection, then <button type="button" class="g-link" id="gRetry">try again</button>.</p>'; $('gRetry').onclick = showPick; return; }
    const last = ls.get('tm_last_mgr');
    $('gBody').innerHTML = `<h2>Who are you?</h2>
      ${msgAfter ? `<p class="g-err">${esc(msgAfter)}</p>` : ''}
      <div class="g-names">${mgrs.map(m => `<button type="button" class="g-name${m.driver_id === last ? ' last' : ''}" data-g="${esc(m.driver_id)}"><span class="g-ini">${esc(m.name.split(' ').map(w => w[0]).join('').slice(0, 2))}</span>${esc(m.name)}</button>`).join('')}</div>
      <p class="g-muted">Not on the list? Managers are set on the Drivers screen (Role: Manager). Ask Tim.</p>`;
    msgAfter = '';
    $('gBody').querySelectorAll('[data-g]').forEach(b => b.onclick = () => showPin(mgrs.find(m => m.driver_id === b.dataset.g)));
  }
  function showPin(m, err) {
    pick = m; ls.set('tm_last_mgr', m.driver_id);
    if (!m.has_pin) return showSetup(m);
    $('gBody').innerHTML = `<h2>Hi, ${esc(m.name.split(' ')[0])}</h2>
      <label class="g-lbl" for="gPin">Your PTO / time off PIN</label>
      <input id="gPin" class="g-pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="6" placeholder="••••">
      <p class="g-err" id="gErr">${err ? esc(err) : ''}</p>
      <button type="button" class="g-go" id="gGo">Sign in</button>
      <div class="g-row"><button type="button" class="g-link" id="gBack">‹ Not ${esc(m.name.split(' ')[0])}?</button>
        <button type="button" class="g-link" id="gSetup">No PTO PIN? Use a setup code</button></div>
      <p class="g-muted">You'll stay signed in on this device until you tap <b>Sign out</b>.</p>`;
    $('gGo').onclick = signIn;
    $('gPin').addEventListener('keydown', e => { if (e.key === 'Enter') signIn(); });
    $('gBack').onclick = showPick;
    $('gSetup').onclick = () => showSetup(m);
    setTimeout(() => $('gPin').focus(), 50);
  }
  function showSetup(m) {
    $('gBody').innerHTML = `<h2>First time, ${esc(m.name.split(' ')[0])}</h2>
      <p class="g-muted">Type the setup code Tim or Chris gave you (Driver Messages › Driver Sign-in), then make a PIN.</p>
      <label class="g-lbl" for="gCode">Setup code</label><input id="gCode" class="g-pin" autocapitalize="characters" autocomplete="off" maxlength="12">
      <label class="g-lbl" for="gNew">New PIN (4–6 numbers)</label><input id="gNew" class="g-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">
      <label class="g-lbl" for="gNew2">Same PIN again</label><input id="gNew2" class="g-pin" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password">
      <p class="g-err" id="gErr"></p>
      <button type="button" class="g-go" id="gGo">Make my PIN and sign in</button>
      <div class="g-row"><button type="button" class="g-link" id="gBack">‹ Back</button></div>`;
    $('gGo').onclick = createPin;
    $('gBack').onclick = () => (m.has_pin ? showPin(m) : showPick());
    setTimeout(() => $('gCode').focus(), 50);
  }

  async function signIn() {
    if (busy || !pick) return;
    const pin = $('gPin').value.trim();
    if (!/^\d{4,6}$/.test(pin)) { $('gErr').textContent = 'Type your 4–6 number PIN.'; return; }
    busy = true; $('gGo').disabled = true; $('gGo').textContent = 'Checking…';
    try {
      const r = await rpc('tm_login', { p_driver_id: pick.driver_id, p_pin: pin });
      if (!r.ok) { busy = false; return showPin(pick, r.needs_setup ? 'Use a setup code the first time (link below).' : (r.error || 'That PIN didn\'t work.')); }
      done(r.token);
    } catch (e) { busy = false; showPin(pick, 'Can\'t reach the server. Check the connection and try again.'); }
  }
  async function createPin() {
    if (busy || !pick) return;
    const code = $('gCode').value.trim(), a = $('gNew').value.trim(), b = $('gNew2').value.trim();
    if (!code) { $('gErr').textContent = 'Type the setup code.'; return; }
    if (!/^\d{4,6}$/.test(a)) { $('gErr').textContent = 'The PIN must be 4–6 numbers.'; return; }
    if (a !== b) { $('gErr').textContent = 'The two PINs don\'t match.'; return; }
    busy = true; $('gGo').disabled = true;
    try {
      const r = await rpc('tm_create_pin', { p_driver_id: pick.driver_id, p_setup_code: code, p_pin: a });
      if (!r.ok) { busy = false; $('gGo').disabled = false; $('gErr').textContent = r.error || 'That didn\'t work.'; return; }
      pick.has_pin = true; done(r.token);
    } catch (e) { busy = false; $('gGo').disabled = false; $('gErr').textContent = 'Can\'t reach the server. Try again.'; }
  }
  function done(token) {
    busy = false;
    ls.set(TK, token); ls.set('lwhdispatch_id', pick.driver_id);
    unlock({ id: pick.driver_id, name: pick.name });
    const f = document.getElementById('dmFrame'); if (f && f.getAttribute('src') && window.TMDriverMsgs) TMDriverMsgs.reload();
  }

  async function signOut() {
    if (!confirm('Sign out of Transportation Manager on this device?\n\nThis also signs you out of Trailer Inspections here.')) return;
    const t = ls.get(TK);
    if (t) { try { await rpc('drv_logout', { p_token: t }); } catch (e) {} }
    ls.set(TK, null); ls.set('tm_me', null);
    try { if (window.TMApp && TMApp.trailerSignOut) TMApp.trailerSignOut(); } catch (e) {}
    try { const f = document.getElementById('dmFrame'); if (f && f.getAttribute('src') && window.TMDriverMsgs) TMDriverMsgs.reload(); } catch (e) {}
    if (window.TMApp) TMApp.open('home');
    lock();
  }

  document.addEventListener('click', e => { if (e.target.closest('[data-tm-signout]')) signOut(); });
  window.addEventListener('load', check);
  return { check, lock, signOut, me: () => me, signedIn: () => !!me };
})();
