/* Drivers — the master driver list (Supabase "drivers" function).
   Add, edit and mark drivers inactive here; the payroll timecard, Unpaid
   Time Off and the trailer inspection list pick changes up within the hour.
   Pay rates are never stored or shown here. */
window.TMDrivers = (function () {
  'use strict';
  const API = (window.TM_CONFIG || {}).DRIVERS_API_URL || 'https://tjivcqxnkftujceumdtx.supabase.co/functions/v1/drivers';
  const $ = id => document.getElementById(id);
  const esc = TS.esc;
  const PASS_KEY = 'tm_drvpass', PASS_MS = 8 * 60 * 60 * 1000;
  const st = { pass: loadPass(), rows: [], locations: [], loaded: false, sort: { key: 'name', asc: true }, editing: null };

  function loadPass() { try { const s = JSON.parse(localStorage.getItem(PASS_KEY)); return s && Date.now() - s.at < PASS_MS ? s.p : ''; } catch (e) { return ''; } }
  function savePass(p) { try { p ? localStorage.setItem(PASS_KEY, JSON.stringify({ p, at: Date.now() })) : localStorage.removeItem(PASS_KEY); } catch (e) {} st.pass = p || ''; }

  async function api(body) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
    let res;
    try { res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal }); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'The driver list took too long to answer. Try again.' : 'No connection to the driver list.'); }
    finally { clearTimeout(t); }
    const j = await res.json().catch(() => ({}));
    if (!j.ok) {
      const err = new Error(j.error || ('Request failed (' + res.status + ')'));
      err.auth = res.status === 403; throw err;
    }
    return j;
  }

  /* ---------- sign in ---------- */
  function shell() {
    $('drvLogin').hidden = !!st.pass;
    $('drvPanel').hidden = !st.pass;
    if (st.pass) { if (!st.loaded) load(); else render(); }
    else setTimeout(() => $('drvPass').focus(), 50);
  }
  async function login() {
    const p = $('drvPass').value.trim();
    if (!p) return;
    $('drvPassErr').textContent = '';
    await TS.run(async () => {
      try { await api({ action: 'verify', passcode: p }); savePass(p); $('drvPass').value = ''; shell(); }
      catch (e) { $('drvPassErr').textContent = e.message; }
    }, 'Checking passcode…');
  }
  function signOut() { savePass(''); st.rows = []; st.loaded = false; shell(); }

  /* ---------- list ---------- */
  function load() {
    return TS.run(async () => {
      try {
        const j = await api({ action: 'admin_list', passcode: st.pass });
        st.rows = j.drivers || []; st.locations = j.locations || []; st.loaded = true;
        fillLocations(); render();
      } catch (e) { if (e.auth) { signOut(); $('drvPassErr').textContent = e.message; } throw e; }
    }, 'Loading drivers…');
  }
  function fillLocations() {
    const sel = $('drvFLoc'), keep = sel.value;
    sel.innerHTML = '<option value="">All locations</option>' + st.locations.map(l => `<option>${esc(l)}</option>`).join('');
    sel.value = keep;
    $('drvLocList').innerHTML = st.locations.map(l => `<option value="${esc(l)}">`).join('');
  }
  function filtered() {
    const q = $('drvSearch').value.trim().toLowerCase(), fs = $('drvFStatus').value, fl = $('drvFLoc').value, ft = $('drvFType').value;
    return st.rows.filter(d => (!fs || d.status === fs) && (!fl || d.location === fl) &&
      (!ft || (ft === 'Manager' ? d.role !== 'Driver' : d.truck_type === ft)) &&
      (!q || (d.name + ' ' + (d.goes_by || '') + ' ' + d.driver_id).toLowerCase().includes(q)));
  }
  const fmtDate = s => { if (!s) return '—'; const [y, m, d] = s.split('-'); return +m + '/' + +d + '/' + y; };
  function render() {
    const active = st.rows.filter(d => d.status === 'Active');
    $('drvKActive').textContent = active.filter(d => d.role === 'Driver').length;
    $('drvKDay').textContent = active.filter(d => d.truck_type === 'Day Cabs').length;
    $('drvKSpot').textContent = active.filter(d => d.truck_type === 'Spotters').length;
    $('drvKInactive').textContent = st.rows.filter(d => d.status === 'Inactive').length;
    const rows = filtered();
    const { key, asc } = st.sort;
    rows.sort((a, b) => { const c = String(a[key] || '').localeCompare(String(b[key] || '')); return (asc ? c : -c) || a.name.localeCompare(b.name); });
    document.querySelectorAll('#drvTable th').forEach(th => { th.classList.toggle('sorted', th.dataset.sort === key); th.classList.toggle('asc', th.dataset.sort === key && asc); });
    $('drvCount').textContent = rows.length + ' of ' + st.rows.length;
    $('drvTable').querySelector('tbody').innerHTML = rows.length ? rows.map(d => `
      <tr class="click${d.status === 'Inactive' ? ' drv-inactive' : ''}" data-id="${esc(d.id)}">
        <td><b>${esc(d.name)}</b>${d.goes_by ? `<div class="muted" style="font-size:12px">goes by ${esc(d.goes_by)}</div>` : ''}${d.role !== 'Driver' ? ` <span class="badge b-Reviewed">${esc(d.role)}</span>` : ''}</td>
        <td>${esc(d.driver_id)}</td>
        <td>${esc(d.truck_type || '—')}</td>
        <td>${esc(d.location || '—')}</td>
        <td>${fmtDate(d.start_date)}</td>
        <td>${d.status === 'Active' ? '<span class="st-active">Active</span>' : '<span class="st-none">Inactive</span>' + (d.end_date ? `<div class="muted" style="font-size:12px">left ${fmtDate(d.end_date)}</div>` : '')}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="empty-cell">No drivers match.</td></tr>';
  }

  /* ---------- add / edit ---------- */
  function suggestId(name) {
    const p = name.trim().toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean);
    if (p.length < 2) return '';
    let id = (p[0][0] + p[p.length - 1]).slice(0, 8);
    const used = new Set(st.rows.filter(r => r !== st.editing).map(r => r.driver_id));
    let n = 2, base = id; while (used.has(id)) id = base.slice(0, 7) + n++;
    return id;
  }
  function open(d) {
    st.editing = d || null;
    $('drvModalTitle').textContent = d ? 'Edit ' + d.name : 'Add driver';
    $('dfName').value = d ? d.name : '';
    $('dfGoesBy').value = d ? (d.goes_by || '') : '';
    $('dfId').value = d ? d.driver_id : '';
    $('dfStatus').value = d ? d.status : 'Active';
    $('dfType').value = d ? (d.truck_type || '') : 'Day Cabs';
    $('dfLoc').value = d ? (d.location || '') : '';
    $('dfStart').value = d ? (d.start_date || '') : new Date().toLocaleDateString('en-CA');
    $('dfEnd').value = d ? (d.end_date || '') : '';
    $('dfRole').value = d ? d.role : 'Driver';
    $('dfPhone').value = d ? (d.phone || '') : '';
    $('dfEmail').value = d ? (d.email || '') : '';
    $('dfSamsara').value = d ? (d.samsara_id || '') : '';
    $('dfNotes').value = d ? (d.notes || '') : '';
    $('dfId').dataset.auto = d ? '' : '1';
    $('dfHint').textContent = d ? '' : 'New drivers show up in payroll with the pay rate highlighted for whoever runs payroll to fill in.';
    $('dfMeta').textContent = d && d.updated_at ? 'Last changed ' + new Date(d.updated_at).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + (d.updated_by ? ' by ' + d.updated_by : '') : '';
    hint();
    $('drvModal').showModal();
    setTimeout(() => $('dfName').focus(), 50);
  }
  function hint() {
    const d = st.editing; if (!d) return;
    const msgs = [];
    const nm = $('dfName').value.trim();
    if (nm && nm !== d.name) msgs.push('Renaming carries their payroll hours and time off history over to the new name.');
    const gb = $('dfGoesBy').value.trim();
    if (gb !== (d.goes_by || '')) msgs.push('Time Off and the trailer inspection list will show ' + (gb || nm || d.name) + '. Payroll keeps the legal name.');
    if ($('dfStatus').value === 'Inactive' && d.status === 'Active') msgs.push('Inactive drivers drop off every app\'s name list. Their history stays.');
    $('dfHint').textContent = msgs.join(' ');
  }
  async function save(ev) {
    ev.preventDefault();
    const d = {
      id: st.editing ? st.editing.id : undefined,
      name: $('dfName').value, goes_by: $('dfGoesBy').value.trim() || null, driver_id: $('dfId').value, status: $('dfStatus').value,
      truck_type: $('dfType').value, location: $('dfLoc').value, start_date: $('dfStart').value,
      end_date: $('dfStatus').value === 'Inactive' ? ($('dfEnd').value || new Date().toLocaleDateString('en-CA')) : $('dfEnd').value,
      role: $('dfRole').value, phone: $('dfPhone').value, email: $('dfEmail').value,
      samsara_id: $('dfSamsara').value, notes: $('dfNotes').value
    };
    const btn = $('dfSave'); TS.setBusyBtn(btn, true, 'Saving…');
    try {
      const j = await api({ action: 'save', passcode: st.pass, driver: d, by: (window.TMApp && TMApp.managerName()) || 'Manager app' });
      const i = st.rows.findIndex(r => r.id === j.driver.id);
      if (i > -1) st.rows[i] = j.driver; else st.rows.push(j.driver);
      if (j.driver.location && !st.locations.includes(j.driver.location)) { st.locations.push(j.driver.location); st.locations.sort(); fillLocations(); }
      $('drvModal').close(); render();
      TS.toast((st.editing ? 'Saved ' : 'Added ') + j.driver.name, 'ok');
    } catch (e) {
      if (e.auth) { $('drvModal').close(); signOut(); }
      TS.toast(e.message, 'err');
    } finally { TS.setBusyBtn(btn, false); }
  }
  function exportCsv() {
    const cols = ['name', 'goes_by', 'driver_id', 'role', 'status', 'truck_type', 'location', 'start_date', 'end_date', 'email', 'phone', 'samsara_id', 'notes'];
    TS.csv('drivers-' + new Date().toLocaleDateString('en-CA') + '.csv',
      ['Driver Name', 'Driver ID', 'Role', 'Status', 'Truck Type', 'Location', 'Start Date', 'Last Day', 'Email', 'Phone', 'Samsara ID', 'Notes'],
      filtered().map(d => cols.map(c => d[c] || '')));
  }

  /* ---------- wiring ---------- */
  $('drvPassGo').onclick = login;
  $('drvPass').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
  $('drvSignOut').onclick = signOut;
  ['drvSearch', 'drvFStatus', 'drvFLoc', 'drvFType'].forEach(id => $(id).addEventListener(id === 'drvSearch' ? 'input' : 'change', render));
  $('drvTable').querySelector('thead').addEventListener('click', e => {
    const k = e.target.dataset.sort; if (!k) return;
    st.sort.asc = st.sort.key === k ? !st.sort.asc : true; st.sort.key = k; render();
  });
  $('drvTable').querySelector('tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-id]'); if (tr) open(st.rows.find(r => r.id === tr.dataset.id));
  });
  $('drvAdd').onclick = () => open(null);
  $('drvCsv').onclick = exportCsv;
  $('drvForm').addEventListener('submit', save);
  $('drvModalClose').onclick = () => $('drvModal').close();
  $('drvModal').addEventListener('click', e => { if (e.target.id === 'drvModal') $('drvModal').close(); });
  $('dfGoesBy').addEventListener('input', hint);
  $('dfName').addEventListener('input', () => { if ($('dfId').dataset.auto) $('dfId').value = suggestId($('dfName').value); hint(); });
  $('dfId').addEventListener('input', () => { $('dfId').dataset.auto = ''; });
  $('dfStatus').addEventListener('change', () => { if ($('dfStatus').value === 'Inactive' && !$('dfEnd').value) $('dfEnd').value = new Date().toLocaleDateString('en-CA'); hint(); });

  return { open: shell, refresh: () => { if (st.pass) load(); } };
})();
