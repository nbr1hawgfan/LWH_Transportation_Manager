/* Driver Hours (v2.1.0) — the Driver Hours tool's week, inside Transportation Manager. Read only.
   Data: a copy of TLand dbo.DriverHoursEntry that APP02 sends up every 15 minutes (5 AM–8 PM) with
   Sync-DriverHoursUp.ps1 → Supabase dh_days. Hours only — pay rates never leave the server.
   Edits still happen in the Driver Hours tool (or fix punches on the Time Clock).
   Sign-in: the Driver Messages sign-in (role Manager). */
window.TMDriverHours = (function () {
  'use strict';
  const API = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const num = v => (v == null || v === '' ? null : +v);
  const f2 = v => (v == null ? '' : (+v).toFixed(2));
  const token = () => { try { return localStorage.getItem('lwhdispatch_token') || ''; } catch (e) { return ''; } };
  const sunday = s => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() - d.getDay()); return iso(d); };
  const SRC = { SAMSARA: 'Samsara', CLOCK: 'Time clock', MANUAL: 'Typed in', TYPED: 'Typed in' };
  let st = { week: sunday(iso(new Date())), data: null, sel: null, loading: false };

  async function load() {
    if (st.loading) return;
    if (!token()) return signedOut();
    st.loading = true; $('dhStatus').textContent = 'Loading…';
    try {
      const r = await fetch(API + 'dh_week', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_token: token(), p_week_start: st.week }), cache: 'no-store' }).then(r => r.json());
      if (!r.ok) { if (r.error === 'not_manager') return signedOut(true); throw new Error(r.error || 'error'); }
      st.data = r; st.week = r.week_start; render();
    } catch (e) { $('dhStatus').textContent = 'Could not load: ' + e.message + '. Check the connection and tap Refresh.'; }
    finally { st.loading = false; }
  }
  function signedOut(notMgr) {
    $('dhOut').innerHTML = `<div class="dh-sign"><b>${notMgr ? 'Managers only.' : 'Sign in first.'}</b>
      <p>Driver Hours uses the Driver Messages sign-in (your Driver ID and PTO PIN).</p>
      <button type="button" class="btn red" data-go="messages">Open Driver Messages</button></div>`;
    $('dhStatus').textContent = '';
  }

  function render() {
    const r = st.data, ws = new Date(r.week_start + 'T00:00:00');
    const days = [...Array(7)].map((_, i) => { const d = new Date(ws); d.setDate(d.getDate() + i); return iso(d); });
    const we = new Date(ws); we.setDate(we.getDate() + 6);
    $('dhWeek').textContent = ws.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' – ' + we.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    $('dhDate').value = r.week_start;
    const s = r.synced;
    $('dhStatus').innerHTML = s && s.at
      ? `Copied from the Driver Hours tool ${esc(new Date(s.at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}. Updates every 15 minutes, 5 AM–8 PM.`
        + (s.from && r.week_start < s.from ? ' <b>This week is older than the copy (last 90 days).</b>' : '')
      : '<b>Waiting for the first copy from the server.</b> Hours show up here once Sync-DriverHoursUp.ps1 runs on APP02.';

    const groups = {};
    (r.drivers || []).forEach(d => {
      const by = {}; (d.days || []).forEach(x => { by[x.date] = x; });
      const has = (d.days || []).some(x => num(x.hours) || num(x.pto) || num(x.hol) || x.review || x.note);
      if (!has && !d.active) return;
      (groups[d.grp] = groups[d.grp] || []).push({ d, by, has });
    });
    const order = Object.keys(groups).sort((a, b) => (a === 'Day Cabs' ? -1 : b === 'Day Cabs' ? 1 : a === 'Spotters' ? -1 : b === 'Spotters' ? 1 : a.localeCompare(b)));
    const head = days.map(x => { const d = new Date(x + 'T00:00:00'); return `<th>${d.toLocaleDateString([], { weekday: 'short' })}<small>${d.getMonth() + 1}/${d.getDate()}</small></th>`; }).join('');
    let review = 0;
    const body = order.map(g => {
      const list = groups[g];
      const rows = list.map(({ d, by }) => {
        let worked = 0, pto = 0, hol = 0;
        const cells = days.map(x => {
          const e = by[x]; if (!e) return '<td class="dh-c"><span class="dh-box"></span></td>';
          const h = num(e.hours), p = num(e.pto), ho = num(e.hol);
          worked += h || 0; pto += p || 0; hol += ho || 0; if (e.review) review++;
          const src = (e.source || '').toUpperCase();
          const tag = src === 'CLOCK' ? 'C' : src === 'SAMSARA' ? '' : (e.by ? 'typed' : '');
          const s2 = num(e.samsara), c2 = num(e.clock);
          const was = src !== 'SAMSARA' && s2 != null && s2 !== h ? `S ${f2(s2)}` : '';
          const extra = [p ? `PTO ${f2(p)}` : '', ho ? `Hol ${f2(ho)}` : '', was, tag && tag !== 'typed' ? tag : '', e.note ? 'N' : ''].filter(Boolean).join(' ');
          return `<td class="dh-c"><button type="button" class="dh-box${e.review ? ' rev' : ''}${tag === 'typed' ? ' typed' : ''}" data-dh="${esc(d.driver_id)}|${x}">${h != null && h !== 0 ? f2(h) : (h === 0 ? '0' : '')}</button>${extra ? `<small>${esc(extra)}</small>` : ''}</td>`;
        }).join('');
        const reg = Math.min(40, worked), ot = Math.max(0, worked - 40), tot = worked + pto + hol;
        return `<tr><th class="dh-name"><b>${esc(d.name)}</b><span>${esc(d.driver_id)}${d.goes_by && d.goes_by !== d.name ? ' · goes by ' + esc(d.goes_by) : ''}</span></th>${cells}
          <td class="dh-n">${worked ? f2(reg) : ''}</td><td class="dh-n ot">${ot ? f2(ot) : ''}</td><td class="dh-n">${pto ? f2(pto) : ''}</td><td class="dh-n">${hol ? f2(hol) : ''}</td><td class="dh-n tot">${tot ? f2(tot) : ''}</td></tr>`;
      }).join('');
      return `<tr class="dh-grp"><td colspan="13">${esc(g)} (${list.length})</td></tr>${rows}`;
    }).join('');
    $('dhOut').innerHTML = (review ? `<div class="dh-warn">${review} day${review > 1 ? 's' : ''} in red need checking (Samsara over 14 hours, or a missing clock-in/out). Fix them in the Driver Hours tool — or fix the punches on the Time Clock — before approving.</div>` : '')
      + `<div class="dh-wrap"><table class="dh"><thead><tr><th class="dh-name">Driver</th>${head}<th>Reg</th><th>OT</th><th>PTO</th><th>Hol</th><th>Total</th></tr></thead><tbody>${body || '<tr><td colspan="13" class="dh-empty">No hours this week.</td></tr>'}</tbody></table></div>`
      + `<p class="dh-key"><span class="dh-box rev"></span> needs checking · <b>C</b> from the time clock · <b>S 9.15</b> what Samsara showed when the hours were changed · <b>N</b> has a note · Reg / OT = first 40 worked hours / over 40. Tap a day for the details.</p>`;
    if (st.sel) detail(st.sel); else $('dhDetail').innerHTML = '<p class="muted">Tap a day to see the time clock punches, what Samsara showed, and any note.</p>';
  }

  function detail(key) {
    st.sel = key;
    const [id, date] = key.split('|');
    const d = (st.data.drivers || []).find(x => x.driver_id === id); if (!d) return;
    const e = (d.days || []).find(x => x.date === date); if (!e) return;
    document.querySelectorAll('.dh-box.on').forEach(b => b.classList.remove('on'));
    const b = document.querySelector(`[data-dh="${CSS.escape(key)}"]`); if (b) b.classList.add('on');
    const dd = new Date(date + 'T00:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    const row = (k, v) => v == null || v === '' ? '' : `<div class="dh-row"><span>${k}</span><b>${v}</b></div>`;
    $('dhDetail').innerHTML = `<h4>${esc(d.name)}</h4><div class="muted">${esc(dd)}</div>
      ${e.review ? '<div class="dh-warn sm">Needs checking</div>' : ''}
      ${row('Hours', esc(f2(e.hours)))}${row('PTO', num(e.pto) ? esc(f2(e.pto)) : '')}${row('Holiday', num(e.hol) ? esc(f2(e.hol)) : '')}
      ${row('Came from', esc(SRC[(e.source || '').toUpperCase()] || e.source || ''))}
      ${row('Samsara showed', e.samsara != null ? esc(f2(e.samsara)) : '')}
      ${row('Time clock', e.clock != null ? esc(f2(e.clock)) : '')}
      ${e.clock_detail ? `<div class="dh-punch"><span>Punches</span>${esc(e.clock_detail)}</div>` : ''}
      ${row('Truck', esc(e.truck || ''))}
      ${e.note ? `<div class="dh-note"><span>Note</span>${esc(e.note)}</div>` : ''}
      ${e.by ? `<div class="muted sm">Last changed by ${esc(e.by)}${e.at ? ', ' + esc(new Date(e.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}</div>` : ''}
      ${e.clock != null || (e.source || '').toUpperCase() === 'CLOCK' ? `<button type="button" class="btn outline sm" data-att-tab="clock">Open the Time Clock to fix punches</button>` : ''}`;
  }

  function shift(n) { const d = new Date(st.week + 'T00:00:00'); d.setDate(d.getDate() + 7 * n); st.week = iso(d); st.sel = null; load(); }
  document.addEventListener('click', e => { const b = e.target.closest('[data-dh]'); if (b) detail(b.dataset.dh); });
  window.addEventListener('load', () => {
    if (!$('scrHours')) return;
    $('dhPrev').onclick = () => shift(-1);
    $('dhNext').onclick = () => shift(1);
    $('dhThis').onclick = () => { st.week = sunday(iso(new Date())); st.sel = null; load(); };
    $('dhDate').onchange = () => { if ($('dhDate').value) { st.week = sunday($('dhDate').value); st.sel = null; load(); } };
  });
  return { open: load, refresh: load };
})();
