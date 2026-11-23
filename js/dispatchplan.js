/* Dispatch Board > Weekly Plan — the dispatcher's weekly driver sheet as a calendar.
   Data: Supabase dispatch_plan, pushed by the Dispatch Extract Apps Script (gas/DispatchExtract.gs)
   from the dispatcher workbook's weekly tabs. Read-only here: the sheet stays the place to plan. */
window.TMDispatchPlan = (function () {
  'use strict';
  const RPC = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => { try { return localStorage.getItem('lwhdispatch_token') || ''; } catch (e) { return ''; } };
  const st = { data: null, tab: null, loaded: false, day: null, view: null, weekend: false };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const LOAD_RE = /\b0\d{6}\b/g;
  const OFF_RE = /^(off|day off|called? off|call(ed)? in|pto|vacation|sick|holiday|no call|no show|out)\b/i;

  async function rpc(fn, args) {
    const r = await fetch(RPC + fn, { method: 'POST', cache: 'no-store', headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ p_token: token() }, args || {})) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || 'Weekly plan request failed (' + r.status + ')');
    if (j.ok === false) throw new Error(j.error === 'signed_out' ? 'Your sign-in ended. Sign out and back in.' : (j.error || 'Request failed'));
    return j;
  }

  /* ---------- dates ---------- */
  const D = s => new Date(s + 'T12:00:00');
  const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const md = s => { const d = D(s); return (d.getMonth() + 1) + '/' + d.getDate(); };
  const longDate = s => D(s).toLocaleDateString([], { month: 'short', day: 'numeric' });
  function weekDays(start, end) { const out = []; for (let d = D(start); iso(d) <= end; d.setDate(d.getDate() + 1)) out.push(iso(d)); return out; }
  function ago(ts) {
    if (!ts) return 'never';
    const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60); if (h < 24) return h + ' hr ago';
    return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  /* ---------- shape the week ---------- */
  // rows from the server: one per sheet row per day (day null = nothing planned). -> drivers with a cell per day.
  function build(j) {
    const byRow = new Map();
    (j.rows || []).forEach(x => {
      let r = byRow.get(x.row_no);
      if (!r) { r = { row: x.row_no, section: x.section || '', grp: x.grp || x.section || '', truck: x.truck || '', driver: x.driver || '', cells: {} }; byRow.set(x.row_no, r); }
      if (x.day) r.cells[x.day] = { a: x.a || '', n: x.n || '' };
    });
    const rows = [...byRow.values()].sort((a, b) => a.row - b.row);
    const groups = [];
    rows.forEach(r => {
      const name = r.grp || 'Other';
      let g = groups.find(x => x.name === name && x.bullpen === !!r.section);
      if (!g) { g = { name, bullpen: !!r.section, rows: [] }; groups.push(g); }
      g.rows.push(r);
    });
    const first = (j.rows || [])[0];
    const start = first ? first.start : null, end = first ? first.end : null;
    const days = start ? weekDays(start, end) : [];
    rows.forEach(r => {
      r.driver = niceName(r.driver);
      // Spotters: column B is their post (PERNOD AM, GLAT…). Show it under every weekday like a load.
      r.spot = /^spotter/i.test(r.grp);
      if (r.spot) {
        r.post = r.truck; r.truck = '';
        days.filter(d => { const k = D(d).getDay(); return k >= 1 && k <= 5; }).forEach(d => { r.cells[d] = r.cells[d] || { a: '', n: '' }; });
      }
      Object.values(r.cells).forEach(c => {
        if (r.spot) c.post = r.post;
        // OFF can be typed in the day's own column or in its NOTES column (the sheet does both)
        c.offText = isOff(c.a) ? c.a : (isOff(c.n) && (!c.a || r.spot)) ? c.n : '';
        c.off = !!c.offText;
        c.cover = c.off && r.spot && c.a && !isOff(c.a) ? c.a : '';     // spotter off + a name typed in = who covers
        c.noteShown = c.n && c.n !== c.offText ? c.n : '';
      });
    });
    return { rows, groups, start, end, days };
  }
  const isOff = a => OFF_RE.test(String(a || '').trim());
  // "JORDAN P." -> "Jordan P." so every name looks the same
  const niceName = n => (n && n === n.toUpperCase() && /[A-Z]{2}/.test(n)) ? n.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : (n || '');
  const loadsIn = a => (String(a || '').match(LOAD_RE) || []);
  // split "A // B / C" into stops
  const stops = a => String(a || '').split(/\s+\/\/+\s*|\s+\/\s+|\s*\/\/\s*/).map(s => s.trim()).filter(Boolean);
  function fmtStop(s, q) {
    let h = esc(s);
    h = h.replace(LOAD_RE, m => `<button type="button" class="dp-load" data-load="${m}" title="Copy load #">${m}</button>`);
    h = h.replace(/^(yd|yard)\b/i, '<span class="dp-yd">$1</span>');
    h = h.replace(/\((\d)\s*yd\)/i, '<span class="dp-tag">$1 yd</span>');
    if (q) { const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?![^<]*>)', 'ig'); h = h.replace(re, '<mark>$1</mark>'); }
    return h;
  }

  /* ---------- load ---------- */
  async function load(tab) {
    const box = $('dpBox');
    if (!st.loaded) box.innerHTML = '<div class="dp-empty">Loading the weekly plan…</div>';
    try {
      const j = await rpc('dispatch_plan_week', { p_tab: tab || null });
      st.data = j; st.tab = j.tab; st.loaded = true; st.wk = build(j);
      if (!st.day || !st.wk.days.includes(st.day)) st.day = st.wk.days.includes(j.today) ? j.today : (st.wk.days[0] || null);
      fillControls(); render();
    } catch (e) {
      box.innerHTML = `<div class="dp-empty err">${esc(e.message)}</div>`;
    }
  }
  function open() { if (!st.loaded) load(); else render(); }
  function refresh() { return load(st.tab); }

  function fillControls() {
    const j = st.data, w = st.wk;
    const i = (j.weeks || []).findIndex(x => x.tab === st.tab);
    $('dpPrev').disabled = i <= 0; $('dpNext').disabled = i < 0 || i >= j.weeks.length - 1;
    $('dpWeek').innerHTML = (j.weeks || []).map(x => `<option value="${esc(x.tab)}">${esc(longDate(x.start))} – ${esc(longDate(x.end))}${x.start <= j.today && j.today <= x.end ? ' · this week' : ''}</option>`).join('');
    $('dpWeek').value = st.tab || '';
    const gsel = $('dpGroup'), gv = gsel.value;
    gsel.innerHTML = '<option value="">All groups</option>' + w.groups.map(g => `<option value="${esc(g.name)}">${esc(g.bullpen ? g.name + ' (no driver yet)' : g.name)}</option>`).join('');
    if ([...gsel.options].some(o => o.value === gv)) gsel.value = gv;
    $('dpSynced').textContent = 'From the dispatch sheet · updated ' + ago(j.synced_at);
    $('dpSynced').classList.toggle('stale', !j.synced_at || Date.now() - new Date(j.synced_at).getTime() > 3 * 3600e3);
  }

  /* ---------- render ---------- */
  function filteredGroups() {
    const q = $('dpSearch').value.trim().toLowerCase(), g = $('dpGroup').value;
    return st.wk.groups.filter(x => !g || x.name === g).map(x => ({ ...x, rows: x.rows.filter(r => !q ||
      [r.driver, r.truck, r.grp, r.post].some(v => v && v.toLowerCase().includes(q)) ||
      Object.values(r.cells).some(c => (c.a + ' ' + c.n).toLowerCase().includes(q))) })).filter(x => x.rows.length);
  }
  function dayStats(day) {
    let loads = new Set(), working = 0, off = 0;
    st.wk.rows.forEach(r => {
      const c = r.cells[day]; if (!c || !(c.a || c.post || c.off)) return;
      if (!c.off) loadsIn(c.a).forEach(l => loads.add(l));
      if (r.driver && !r.section) { if (c.off) off++; else working++; }
    });
    return { loads: loads.size, working, off };
  }
  function render() {
    if (!st.loaded) return;
    const w = st.wk, box = $('dpBox');
    if (!w.days.length) { box.innerHTML = '<div class="dp-empty">No weeks have come over from the dispatch sheet yet. Once the Dispatch Extract script runs with the sync key, they show up here.</div>'; return; }
    const phone = window.matchMedia('(max-width: 900px)').matches;
    const view = st.view || (phone ? 'day' : 'week');
    document.querySelectorAll('[data-dpview]').forEach(b => b.classList.toggle('active', b.dataset.dpview === view));
    const hasWeekend = w.days.some(d => [0, 6].includes(D(d).getDay()) && w.rows.some(r => r.cells[d] && r.cells[d].a));
    $('dpWeekendWrap').hidden = view !== 'week' || hasWeekend;   // weekend columns always show when they have plans
    const days = w.days.filter(d => view !== 'week' || st.weekend || hasWeekend || ![0, 6].includes(D(d).getDay()));
    const groups = filteredGroups(), q = $('dpSearch').value.trim();
    const today = st.data.today;
    const totals = w.days.reduce((a, d) => { const s = dayStats(d); a.loads += s.loads; return a; }, { loads: 0 });
    const drivers = w.rows.filter(r => r.driver && !r.section && !r.spot).length;
    const spotters = w.rows.filter(r => r.spot).length;
    const bullpen = w.rows.filter(r => r.section).reduce((a, r) => a + Object.values(r.cells).filter(c => c.a).length, 0);

    let html = `<div class="dp-head"><div><h3>Week of ${esc(longDate(w.start))} – ${esc(longDate(w.end))}</h3>
      <span class="hint">Tab ${esc(st.tab)} · ${drivers} drivers${spotters ? ` · ${spotters} spotters` : ''} · ${totals.loads} load #s planned${bullpen ? ` · <b class="dp-bp-n">${bullpen} in the bullpen</b>` : ''}</span></div></div>`;

    if (view === 'week') {
      const quiet = groups.filter(g => !g.bullpen && g.rows.every(r => !Object.values(r.cells).some(c => c.a || c.post || c.off)));
      const busy = groups.filter(g => !quiet.includes(g));
      html += `<div class="dp-scroll"><table class="dp-grid" style="--dp-days:${days.length}"><thead><tr><th class="dp-who">Driver</th>${days.map(d => {
        const s = dayStats(d), dt = D(d);
        return `<th class="${d === today ? 'today' : ''}${[0, 6].includes(dt.getDay()) ? ' wknd' : ''}"><b>${DOW[dt.getDay()]}</b> <span>${md(d)}</span>
          <small>${s.loads ? s.loads + ' loads' : ''}${s.off ? `${s.loads ? ' · ' : ''}${s.off} off` : ''}</small></th>`;
      }).join('')}</tr></thead><tbody>`;
      busy.forEach(g => {
        html += `<tr class="dp-g${g.bullpen ? ' bp' : ''}"><th colspan="${days.length + 1}"><span>${esc(g.bullpen ? g.name : g.name)}</span>${g.bullpen ? '<small>Loads not on a driver yet</small>' : `<small>${g.rows.length} ${g.rows[0].spot ? (g.rows.length === 1 ? 'spotter' : 'spotters') : (g.rows.length === 1 ? 'driver' : 'drivers')}</small>`}</th></tr>`;
        g.rows.forEach(r => {
          html += `<tr class="dp-r"><th class="dp-who">${r.driver ? `<b>${esc(r.driver)}</b>` : g.bullpen ? '<b class="muted">No driver</b>' : ''}${r.truck ? `<span class="dp-truck">${esc(r.truck)}</span>` : ''}</th>` +
            days.map(d => { const b = body(r.cells[d], q), cls = (d === today ? ' today' : '') + ([0, 6].includes(D(d).getDay()) ? ' wknd' : '');
              return `<td class="dp-c ${b.cls}${cls}">${b.html}</td>`; }).join('') + '</tr>';
        });
      });
      html += '</tbody></table></div>';
      if (quiet.length) html += quietHtml(quiet);
    } else {
      html += `<div class="dp-days">${w.days.map(d => { const s = dayStats(d), dt = D(d);
        return `<button type="button" class="dp-day${d === st.day ? ' active' : ''}${d === today ? ' today' : ''}" data-dpday="${d}"><b>${DOW[dt.getDay()]}</b><span>${md(d)}</span><small>${s.loads || '–'}</small></button>`; }).join('')}</div>`;
      const d = st.day, s = dayStats(d);
      html += `<div class="dp-dayhead"><b>${DOWL[D(d).getDay()]}, ${esc(longDate(d))}</b>${d === today ? ' <span class="dp-now">Today</span>' : ''}<span class="hint">${s.working} working · ${s.off} off · ${s.loads} load #s</span></div>`;
      groups.forEach(g => {
        const rows = g.rows.filter(r => g.bullpen ? (r.cells[d] && r.cells[d].a) : true);
        if (!rows.length) return;
        const any = rows.some(r => { const c = r.cells[d]; return c && (c.a || c.post || c.off); });
        if (!any && !g.bullpen) { html += `<div class="dp-lgrp quiet"><span>${esc(g.name)}</span> <small>${rows.map(r => esc(r.driver || r.truck)).join(' · ')}</small> <em>nothing planned</em></div>`; return; }
        html += `<div class="dp-lgrp${g.bullpen ? ' bp' : ''}"><span>${esc(g.name)}</span>${g.bullpen ? '<small>Loads not on a driver yet</small>' : ''}</div>`;
        rows.forEach(r => {
          const b = body(r.cells[d], q, true);
          html += `<div class="dp-card ${b.cls}"><div class="dp-card-who">${r.driver ? `<b>${esc(r.driver)}</b>` : '<b class="muted">No driver</b>'}${r.truck ? `<span class="dp-truck">${esc(r.truck)}</span>` : ''}</div>
            <div class="dp-card-body">${b.html}</div></div>`;
        });
      });
    }
    if (!groups.length) html += '<div class="dp-empty">Nothing matches.</div>';
    html += `<p class="hint dp-foot">Read-only copy of the dispatch sheet. Make changes in the sheet; they show up here after the next sync. Tap a load # to copy it.</p>`;
    box.innerHTML = html;
  }
  // What goes in one driver's day, used by both the week grid and the phone day view.
  function body(c, q, card) {
    if (!c || (!c.a && !c.n && !c.post)) return { cls: 'empty none', html: card ? '<span class="muted">Nothing planned</span>' : '' };
    const note = c.noteShown ? `<span class="dp-note" title="Note">${esc(c.noteShown)}</span>` : '';
    const post = c.post ? `<div class="dp-post">${fmtStop(c.post, q)}</div>` : '';
    if (c.off) {
      return { cls: 'off', html: note + `<span class="dp-offlbl">${esc(c.offText)}</span>` +
        (c.post ? `<div class="dp-post muted-post">${esc(c.post)}</div>` + (c.cover ? `<div class="dp-cover">Covering: <b>${fmtStop(c.cover, q)}</b></div>` : '<div class="dp-need">Needs cover</div>') : '') };
    }
    const hit = q && [c.a, c.n, c.post].join(' ').toLowerCase().includes(q.toLowerCase());
    return { cls: hit ? 'hit' : '', html: note + post + stops(c.a).map(x => `<div class="dp-stop">${fmtStop(x, q)}</div>`).join('') };
  }
  function quietHtml(groups) {
    return `<div class="dp-quiet"><div class="dp-quiet-h">Nothing planned on the sheet this week</div>${groups.map(g => `<div class="dp-quiet-g"><b>${esc(g.name)}</b> ${g.rows.map(r => `<span>${esc(r.driver || '')}${r.truck ? ` <em>${esc(r.truck)}</em>` : ''}</span>`).join('')}</div>`).join('')}</div>`;
  }

  /* ---------- export ---------- */
  function csv() {
    if (!st.loaded) return;
    const w = st.wk, head = ['Group', 'Truck', 'Driver'].concat(w.days.map(d => DOW[D(d).getDay()] + ' ' + d), w.days.map(d => 'Notes ' + DOW[D(d).getDay()]));
    const dayText = c => !c ? '' : [c.post, c.off ? c.offText.toUpperCase() : '', c.cover ? 'Covering: ' + c.cover : (c.off ? '' : c.a)].filter(Boolean).join(' · ');
    const lines = [head].concat(w.rows.map(r => [r.section ? r.section : r.grp, r.truck || r.post || '', r.driver].concat(w.days.map(d => dayText(r.cells[d])), w.days.map(d => (r.cells[d] || {}).n || ''))));
    const body = lines.map(l => l.map(v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv' }));
    a.download = 'dispatch-week-' + w.start + '.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ---------- wiring ---------- */
  function init() {
    if (!$('dpBox')) return;
    $('dpPrev').onclick = () => { const ws = st.data.weeks, i = ws.findIndex(x => x.tab === st.tab); if (i > 0) load(ws[i - 1].tab); };
    $('dpNext').onclick = () => { const ws = st.data.weeks, i = ws.findIndex(x => x.tab === st.tab); if (i >= 0 && i < ws.length - 1) load(ws[i + 1].tab); };
    $('dpThis').onclick = () => { st.day = null; load(null); };
    $('dpWeek').addEventListener('change', e => load(e.target.value));
    $('dpSearch').addEventListener('input', render);
    $('dpGroup').addEventListener('change', render);
    $('dpWeekend').addEventListener('change', e => { st.weekend = e.target.checked; render(); });
    document.querySelectorAll('[data-dpview]').forEach(b => b.onclick = () => { st.view = b.dataset.dpview; render(); });
    $('dpBox').addEventListener('click', e => {
      const l = e.target.closest('[data-load]');
      if (l) { const n = l.dataset.load; (navigator.clipboard ? navigator.clipboard.writeText(n) : Promise.reject()).then(() => window.TS && TS.toast ? TS.toast('Copied load # ' + n, 'ok') : 0).catch(() => {}); return; }
      const d = e.target.closest('[data-dpday]'); if (d) { st.day = d.dataset.dpday; render(); }
    });
    let rt = null; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!st.view && st.loaded && !$('dpBox').hidden) render(); }, 200); });
  }
  window.addEventListener('load', init);
  return { open, refresh, csv };
})();
