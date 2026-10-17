/* Time Off — manager side of Unpaid Time Off (moved from the Time Off app).
   Same Apps Script backend: mgrLogin / mgrData / decide / mgrCancel /
   saveDriver / mgrLogout. Drivers request in the Driver Toolkit. */
window.TMTimeOff = (function () {
  'use strict';
  const API = (window.TM_CONFIG || {}).UTO_API_URL || '';
  const $ = id => document.getElementById(id);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const SESSION_KEY = 'tm_uto', SESSION_MS = 8 * 60 * 60 * 1000 - 5 * 60 * 1000;

  const state = {
    mgr: loadSession(), pin: '',
    requests: [], drivers: [], today: localToday(), loaded: false,
    sub: 'pending', sort: { key: 'occ', asc: false }
  };

  /* ---------- helpers ---------- */
  function loadSession() {
    try { const s = JSON.parse(localStorage.getItem(SESSION_KEY)); return s && Date.now() - s.at < SESSION_MS ? s : null; } catch (e) { return null; }
  }
  function saveSession(s) { try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch (e) {} }
  function localToday() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dObj = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = dObj(s); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const fmtD = (s, yr) => s ? dObj(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: yr ? 'numeric' : undefined }) : '';
  const fmtT = t => { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return h + ':' + String(m).padStart(2, '0') + ' ' + ap; };
  function when(r) {
    if (r.type === 'Partial') return fmtD(r.startDate) + ' · ' + fmtT(r.startTime) + '–' + fmtT(r.endTime);
    return r.startDate === r.endDate ? fmtD(r.startDate) : fmtD(r.startDate) + ' – ' + fmtD(r.endDate);
  }
  const amount = r => r.type === 'Partial' ? r.hours + ' hrs' : r.days + (r.days === 1 ? ' day' : ' days');
  const toast = (m, k) => TS.toast(m, k);

  async function api(action, data = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    let text;
    try {
      const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action }, data)), redirect: 'follow', signal: ctrl.signal });
      text = await res.text();
    } catch (e) {
      throw new Error(e.name === 'AbortError' ? 'The time off server took too long to answer. Try again.' : 'Could not reach the time off server. Check your connection.');
    } finally { clearTimeout(timer); }
    let j;
    try { j = JSON.parse(text); } catch (e) {
      throw new Error(/accounts\.google|ServiceLogin|Sign in/i.test(text)
        ? 'The time off server asked for a Google sign-in. Its deployment access must be "Anyone".'
        : 'The time off server returned a web page instead of data. Check UTO_API_URL in config.js.');
    }
    if (!j.ok) {
      if (j.error === 'SESSION_EXPIRED') { signOut(true); throw new Error('Your time off sign-in expired. Enter your PIN again.'); }
      throw new Error(j.error || 'Request failed');
    }
    return j;
  }
  const run = (fn, msg) => TS.run(fn, msg);

  /* ---------- sign in ---------- */
  function renderPin() { $$('#toPinDots i').forEach((d, i) => d.classList.toggle('on', i < state.pin.length)); }
  function pinKey(k) {
    if (k === 'clr') state.pin = '';
    else if (k === 'go') return login();
    else if (k === 'back') state.pin = state.pin.slice(0, -1);
    else if (state.pin.length < 6) state.pin += k;
    renderPin();
  }
  function login() {
    if (!state.pin) return;
    const pin = state.pin;
    $('toPinErr').textContent = '';
    return run(async () => {
      try {
        const j = await api('mgrLogin', { pin });
        state.mgr = { token: j.token, name: j.manager.name, at: Date.now() };
        saveSession(state.mgr);
        state.pin = ''; renderPin();
        shell();
        if (window.TMApp) TMApp.refreshHub();
      } catch (err) {
        state.pin = ''; renderPin();
        $('toPinErr').textContent = err.message;
        const d = $('toPinDots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
      }
    }, 'Checking PIN…');
  }
  function signOut(silent) {
    if (state.mgr && !silent) api('mgrLogout', { token: state.mgr.token }).catch(() => {});
    state.mgr = null; saveSession(null); state.loaded = false; state.requests = [];
    shell();
    if (window.TMApp) TMApp.refreshHub();
  }

  function shell() {
    $('toLogin').hidden = !!state.mgr;
    $('toPanel').hidden = !state.mgr;
    if (state.mgr) { $('toWho').textContent = 'Signed in as ' + state.mgr.name; load(); }
  }

  function load(quiet) {
    return run(async () => {
      const j = await api('mgrData', { token: state.mgr.token });
      state.requests = j.requests; state.drivers = j.drivers; state.today = j.today || localToday(); state.loaded = true;
      buildYears(); render();
      if (window.TMApp) TMApp.setBadge('timeoff', pending().length);
    }, quiet ? false : 'Loading time off…');
  }
  const pending = () => state.requests.filter(r => r.status === 'Pending');

  /* ---------- views ---------- */
  function setSub(s) {
    state.sub = s;
    $$('#toTabs .tab').forEach(x => x.classList.toggle('active', x.dataset.sub === s));
    $$('#toPanel .to-sub').forEach(x => { x.hidden = x.id !== 'toSub-' + s; });
    render();
  }
  function render() {
    const pc = $('toPendCount'); const n = pending().length;
    pc.textContent = n; pc.hidden = !n;
    ({ pending: renderPending, upcoming: renderUpcoming, drivers: renderDrivers, all: renderAll })[state.sub]();
  }
  const overlaps = (a, b) => a.startDate <= b.endDate && a.endDate >= b.startDate;

  function driverStats(name, year) {
    const today = state.today, d90 = addDays(today, -90);
    const reqs = state.requests.filter(r => r.driverName === name);
    const inYear = reqs.filter(r => !year || r.startDate.slice(0, 4) === String(year));
    const appr = inYear.filter(r => r.status === 'Approved');
    return {
      reqs, total: inYear.length, occ: appr.length,
      days: appr.reduce((s, r) => s + (r.days || 0), 0),
      hours: Math.round(appr.reduce((s, r) => s + (r.hours || 0), 0) * 100) / 100,
      denied: inYear.filter(r => r.status === 'Denied').length,
      r90: reqs.filter(r => r.status === 'Approved' && r.endDate >= d90 && r.startDate <= today).length,
      last: reqs.reduce((m, r) => (r.startDate > m ? r.startDate : m), '')
    };
  }

  function reqCard(r, opts = {}) {
    return `
      <div class="to-req s-${r.status}">
        <div class="to-req-top">
          <div>
            <div class="to-req-name"><a href="#" data-driver="${esc(r.driverName)}">${esc(r.driverName)}</a></div>
            <div class="to-req-when">${esc(when(r))}</div>
            <div class="to-meta">${esc(amount(r))} · ${esc(r.category)} · submitted ${esc(r.submitted)} · ${esc(r.id)}</div>
          </div>
          <span class="to-pill s-${r.status}">${r.status}</span>
        </div>
        <div class="to-reason">${esc(r.reason)}</div>
        ${opts.flags || ''}
        ${r.decidedBy && r.status !== 'Pending' ? `<div class="to-meta">${r.status === 'Cancelled' ? 'Was decided' : esc(r.status)} by ${esc(r.decidedBy)} · ${esc(r.decidedAt)}</div>` : ''}
        ${r.status === 'Cancelled' ? `<div class="to-meta">Cancelled by ${esc(r.cancelledBy)} · ${esc(r.cancelledAt)}</div>` : ''}
        ${r.managerNote ? `<div class="to-note">Note: ${esc(r.managerNote)}</div>` : ''}
        ${opts.actions || ''}
      </div>`;
  }

  function renderPending() {
    const el = $('toPendList');
    const list = pending().sort((a, b) => a.startDate.localeCompare(b.startDate));
    if (!list.length) { el.innerHTML = '<div class="empty">Nothing waiting for approval.</div>'; return; }
    const yr = state.today.slice(0, 4);
    el.innerHTML = list.map(r => {
      const st = driverStats(r.driverName, yr);
      const others = state.requests.filter(x => x.status === 'Approved' && x.driverName !== r.driverName && overlaps(x, r));
      const flags = `<div class="to-flags">
        <span class="to-flag ${st.occ >= 3 ? 'warn' : ''}">${st.occ} approved occurrence${st.occ === 1 ? '' : 's'} in ${yr}</span>
        <span class="to-flag ${st.r90 >= 2 ? 'warn' : ''}">${st.r90} in last 90 days</span>
        ${others.length ? `<span class="to-flag warn">${others.length} other driver${others.length === 1 ? '' : 's'} already off: ${esc(others.map(o => o.driverName).join(', '))}</span>` : ''}
        ${r.startDate < state.today ? '<span class="to-flag warn">Date already passed</span>' : ''}
      </div>`;
      const actions = `<div class="to-actions">
        <input placeholder="Note to driver (optional)" data-note="${esc(r.id)}" maxlength="500">
        <div class="to-btns">
          <button class="btn green" data-decide="Approved" data-id="${esc(r.id)}">Approve</button>
          <button class="btn red" data-decide="Denied" data-id="${esc(r.id)}">Deny</button>
        </div>
      </div>`;
      return reqCard(r, { flags, actions });
    }).join('');
  }

  function renderUpcoming() {
    const el = $('toUpList');
    const today = state.today, end = addDays(today, 30);
    const appr = state.requests.filter(r => r.status === 'Approved' && r.endDate >= today && r.startDate <= end);
    if (!appr.length) { el.innerHTML = '<div class="empty">No approved time off in the next 30 days.</div>'; return; }
    let html = '';
    for (let d = today; d <= end; d = addDays(d, 1)) {
      const out = appr.filter(r => r.startDate <= d && r.endDate >= d);
      if (!out.length) continue;
      html += `<div class="to-day"><div class="to-day-h"><span>${esc(fmtD(d))}${d === today ? ' · Today' : ''}</span><span>${out.length} out</span></div>
        ${out.map(r => `<div class="to-day-row"><a href="#" data-driver="${esc(r.driverName)}">${esc(r.driverName)}</a>
          <span class="muted">${r.type === 'Partial' ? esc(fmtT(r.startTime) + '–' + fmtT(r.endTime)) : 'All day'}</span></div>`).join('')}</div>`;
    }
    el.innerHTML = html;
  }

  function buildYears() {
    const sel = $('toDrvYear');
    const cur = sel.value || state.today.slice(0, 4);
    const years = new Set([state.today.slice(0, 4)]);
    state.requests.forEach(r => years.add(r.startDate.slice(0, 4)));
    sel.innerHTML = '<option value="">All years</option>' + [...years].sort().reverse().map(y => `<option>${y}</option>`).join('');
    sel.value = cur;
  }

  function renderDrivers() {
    const year = $('toDrvYear').value;
    const q = $('toDrvSearch').value.trim().toLowerCase();
    const known = new Map(state.drivers.map(d => [d.name, d]));
    state.requests.forEach(r => { if (!known.has(r.driverName)) known.set(r.driverName, { name: r.driverName, active: false }); });
    const rows = [...known.values()].filter(d => !q || d.name.toLowerCase().includes(q))
      .map(d => Object.assign({ d }, driverStats(d.name, year), { name: d.name }));
    const { key, asc } = state.sort;
    rows.sort((a, b) => { const va = a[key], vb = b[key]; const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb; return (asc ? c : -c) || a.name.localeCompare(b.name); });
    $$('#toDrvTable th').forEach(th => { th.classList.toggle('sorted', th.dataset.sort === key); th.classList.toggle('asc', th.dataset.sort === key && asc); });
    $('toDrvTable').querySelector('tbody').innerHTML = rows.length ? rows.map(r => `
      <tr class="click${r.d.active ? '' : ' to-inactive'}" data-driver="${esc(r.name)}">
        <td><b>${esc(r.name)}</b></td>
        <td class="${r.occ >= 3 ? 'rate-hi' : ''}">${r.occ}</td>
        <td>${r.days}</td><td>${r.hours}</td>
        <td class="${r.r90 >= 2 ? 'rate-hi' : ''}">${r.r90}</td>
        <td>${r.denied}</td>
        <td>${r.last ? esc(dObj(r.last).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })) : '—'}</td>
      </tr>`).join('') : '<tr><td colspan="7" class="empty-cell">No drivers found.</td></tr>';
  }

  function filteredAll() {
    const q = $('toAllSearch').value.trim().toLowerCase(), st = $('toAllStatus').value;
    return state.requests.filter(r => (!st || r.status === st) && (!q || [r.driverName, r.reason, r.category, r.id].join(' ').toLowerCase().includes(q)));
  }
  function renderAll() {
    const list = filteredAll();
    $('toAllList').innerHTML = list.length
      ? list.slice(0, 200).map(r => reqCard(r, { actions: cancelAction(r) })).join('') + (list.length > 200 ? `<p class="muted center">Showing 200 of ${list.length}. Narrow your search or export CSV.</p>` : '')
      : '<div class="empty">No matching requests.</div>';
  }
  function cancelAction(r) {
    return (r.status === 'Approved' || r.status === 'Pending') && r.endDate >= state.today
      ? `<div class="to-actions"><div class="to-btns"><button class="btn outline sm" data-mcancel="${esc(r.id)}">${r.status === 'Approved' ? 'Revoke / cancel' : 'Cancel'}</button></div></div>` : '';
  }
  function exportCsv() {
    const cols = ['id', 'submitted', 'driverName', 'type', 'startDate', 'endDate', 'startTime', 'endTime', 'days', 'hours', 'category', 'reason', 'status', 'decidedBy', 'decidedAt', 'managerNote', 'cancelledBy', 'cancelledAt'];
    TS.csv('unpaid-time-off-' + state.today + '.csv', cols, filteredAll().map(r => cols.map(c => r[c])));
  }

  /* ---------- actions ---------- */
  function click(e) {
    const t = e.target;
    const drv = t.closest('[data-driver]');
    if (drv) { e.preventDefault(); return openDriver(drv.dataset.driver); }
    const dec = t.closest('[data-decide]');
    if (dec) {
      const id = dec.dataset.id, decision = dec.dataset.decide;
      const noteEl = document.querySelector(`[data-note="${CSS.escape(id)}"]`);
      const note = noteEl ? noteEl.value : '';
      const r = state.requests.find(x => x.id === id);
      if (!confirm(`${decision === 'Approved' ? 'Approve' : 'Deny'} ${r.driverName} — ${when(r)}?`)) return;
      return run(async () => {
        await api('decide', { token: state.mgr.token, id, decision, note });
        toast(decision === 'Approved' ? 'Approved — calendar invite emailed' : 'Denied — driver notified', 'ok');
        await load(true);
      }, 'Saving…');
    }
    const mc = t.closest('[data-mcancel]');
    if (mc) {
      const id = mc.dataset.mcancel;
      const r = state.requests.find(x => x.id === id);
      const note = prompt(`Cancel ${r.driverName} — ${when(r)}?\nOptional note to driver:`, '');
      if (note === null) return;
      return run(async () => {
        await api('mgrCancel', { token: state.mgr.token, id, note });
        toast('Request cancelled' + (r.status === 'Approved' ? ' — calendar cancellation sent' : ''), 'ok');
        await load(true);
        if ($('toModal').open) openDriver(r.driverName);
      }, 'Saving…');
    }
    const ed = t.closest('[data-editdriver]');
    if (ed) return driverForm(state.drivers.find(x => x.name === ed.dataset.editdriver));
  }

  function openDriver(name) {
    const yr = state.today.slice(0, 4);
    const st = driverStats(name, yr), all = driverStats(name, '');
    const list = st.reqs.slice().sort((a, b) => b.startDate.localeCompare(a.startDate));
    $('toModalTitle').textContent = name;
    $('toModalBody').innerHTML = `
      <div class="kpis">
        <div class="kpi"><b>${st.occ}</b><span>Occurrences ${yr}</span></div>
        <div class="kpi"><b>${st.days}</b><span>Days ${yr}</span></div>
        <div class="kpi amber"><b>${st.r90}</b><span>Last 90 days</span></div>
        <div class="kpi"><b>${all.occ}</b><span>All time</span></div>
      </div>
      ${list.length ? list.map(r => reqCard(r, { actions: cancelAction(r) })).join('') : '<div class="empty">No requests.</div>'}
      ${state.drivers.find(x => x.name === name) ? `<button class="btn outline block" data-editdriver="${esc(name)}">Edit driver</button>` : ''}`;
    openModal();
  }

  function driverForm(d) {
    const isNew = !d;
    d = d || { name: '', email: '', active: true };
    $('toModalTitle').textContent = isNew ? 'Add driver' : 'Edit driver';
    $('toModalBody').innerHTML = `
      <form id="toDriverForm">
        <label class="lbl">Name (as it shows in the drivers' list)</label><input name="name" value="${esc(d.name)}" required>
        <label class="lbl" style="margin-top:12px">Email (optional — gets decision emails)</label><input name="email" type="email" value="${esc(d.email)}">
        <label class="to-check"><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Active (shows in the drivers' list)</label>
        <button class="btn red block" type="submit">Save</button>
      </form>`;
    $('toDriverForm').addEventListener('submit', ev => {
      ev.preventDefault();
      const f = ev.target;
      const payload = { originalName: isNew ? '' : d.name, name: f.name.value.trim(), email: f.email.value.trim(), active: f.active.checked };
      run(async () => {
        await api('saveDriver', { token: state.mgr.token, driver: payload });
        toast('Driver saved', 'ok');
        closeModal();
        await load(true);
      }, 'Saving…');
    });
    openModal();
  }
  function openModal() { const m = $('toModal'); if (!m.open) m.showModal(); }
  function closeModal() { $('toModal').close(); }

  /* ---------- wiring ---------- */
  $('toKeypad').addEventListener('click', e => { const b = e.target.closest('button'); if (b) pinKey(b.dataset.k || b.textContent.trim()); });
  document.addEventListener('keydown', e => {
    if ($('scrTimeOff').hidden || state.mgr || $('toModal').open) return;
    if (/^\d$/.test(e.key)) pinKey(e.key);
    else if (e.key === 'Backspace') pinKey('back');
    else if (e.key === 'Enter') pinKey('go');
  });
  $('toSignOut').onclick = () => { if (confirm('Sign out of Time Off?')) signOut(); };
  $$('#toTabs .tab').forEach(b => b.onclick = () => setSub(b.dataset.sub));
  $('toPanel').addEventListener('click', click);
  $('toModalBody').addEventListener('click', click);
  $('toModalClose').onclick = closeModal;
  $('toModal').addEventListener('click', e => { if (e.target.id === 'toModal') closeModal(); });
  $('toDrvTable').querySelector('thead').addEventListener('click', e => {
    const k = e.target.dataset.sort; if (!k) return;
    state.sort.asc = state.sort.key === k ? !state.sort.asc : k === 'name';
    state.sort.key = k; renderDrivers();
  });
  $('toDrvSearch').addEventListener('input', renderDrivers);
  $('toDrvYear').addEventListener('change', renderDrivers);
  $('toAddDriver').onclick = () => driverForm(null);
  $('toAllSearch').addEventListener('input', renderAll);
  $('toAllStatus').addEventListener('change', renderAll);
  $('toCsv').onclick = exportCsv;

  // Quietly count pending requests for the home screen badge
  async function peek() {
    if (!state.mgr) return null;
    try {
      const j = await api('mgrData', { token: state.mgr.token });
      state.requests = j.requests; state.drivers = j.drivers; state.today = j.today || localToday(); state.loaded = true;
      return pending().length;
    } catch (e) { return null; }
  }

  return {
    open() { shell(); },
    refresh() { if (state.mgr) load(); },
    signedIn: () => !!state.mgr,
    name: () => state.mgr ? state.mgr.name : '',
    peek, signOut
  };
})();
