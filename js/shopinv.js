/* Shop Inventory — trailer shop parts on hand at two locations: Trailer Shop and Off-Site Shop
   (the portable building on the customer yard). Supabase shop_parts / shop_stock / shop_stock_moves.
   Uses the Transportation Manager sign-in (managers only). Techs see stock and log parts in the
   Trailer Shop app; parts logged on a repair come off stock at the location they took them from. */
window.TMShopInv = (function () {
  'use strict';
  const RPC = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const $ = id => document.getElementById(id);
  const esc = TS.esc;
  const token = () => { try { return localStorage.getItem('lwhdispatch_token') || ''; } catch (e) { return ''; } };
  const st = { loaded: false, parts: [], locs: [], byId: {}, labels: {}, tab: 'stock', sort: { key: 'description', asc: true },
               editing: null, moves: [], movesDays: 0, imp: [] };

  const CATS = ['Tires & wheels', 'Air system', 'Brakes', 'Wheel end', 'Lighting & electrical', 'Suspension', 'Landing gear', 'Doors & body', 'Mud flaps & DOT', 'Shop supplies'];
  // Starter list (names only, nothing counted): common trailer shop stock. Delete what the shop doesn't keep.
  const STARTER = [
    ['Tires & wheels', 'Trailer tire 295/75R22.5'], ['Tires & wheels', 'Trailer tire 11R22.5'], ['Tires & wheels', 'Mounted spare (tire on wheel)'],
    ['Tires & wheels', 'Valve stem'], ['Tires & wheels', 'Lug nut'], ['Tires & wheels', 'Wheel stud'], ['Tires & wheels', 'Tire patch / plug kit'],
    ['Air system', 'Gladhand'], ['Air system', 'Gladhand seal'], ['Air system', 'Air line coil (red)'], ['Air system', 'Air line coil (blue)'],
    ['Air system', 'Air hose, straight'], ['Air system', 'Brake hose (chamber)'], ['Air system', 'Air line fitting / push-to-connect'],
    ['Air system', 'Air tank drain valve'], ['Air system', 'Relay valve'], ['Air system', 'Air line tubing (ft)', 'ft'],
    ['Brakes', 'Brake chamber 30/30 (spring brake)'], ['Brakes', 'Service chamber 30'], ['Brakes', 'Spring brake piggyback'], ['Brakes', 'Slack adjuster (auto)'],
    ['Brakes', 'Brake shoe kit'], ['Brakes', 'Brake drum'], ['Brakes', 'S-cam bushing kit'], ['Brakes', 'Brake return spring'], ['Brakes', 'Shoe roller / anchor pin kit'],
    ['Wheel end', 'Wheel seal'], ['Wheel end', 'Bearing set (inner / outer)'], ['Wheel end', 'Hub cap with sight glass'], ['Wheel end', 'Hub cap gasket'],
    ['Wheel end', 'ABS sensor'], ['Wheel end', 'Hub oil', 'qt'],
    ['Lighting & electrical', 'Stop / turn / tail light 4 in'], ['Lighting & electrical', 'Marker / clearance light (red)'], ['Lighting & electrical', 'Marker / clearance light (amber)'],
    ['Lighting & electrical', 'Light grommet'], ['Lighting & electrical', 'Light pigtail'], ['Lighting & electrical', 'License plate light'],
    ['Lighting & electrical', '7-way receptacle (nose box)'], ['Lighting & electrical', '7-way plug'], ['Lighting & electrical', 'Trailer wire (ft)', 'ft'],
    ['Lighting & electrical', 'Butt connector / heat shrink', 'box'], ['Lighting & electrical', 'Bulb'],
    ['Suspension', 'Air bag (air spring)'], ['Suspension', 'Shock absorber'], ['Suspension', 'Leveling valve'],
    ['Landing gear', 'Landing gear crank handle'], ['Landing gear', 'Landing gear foot / shoe'],
    ['Doors & body', 'Door hinge'], ['Doors & body', 'Door seal (ft)', 'ft'], ['Doors & body', 'Door lock rod keeper / cam'], ['Doors & body', 'Door hold-back'],
    ['Doors & body', 'Roof / side patch'],
    ['Mud flaps & DOT', 'Mud flap'], ['Mud flaps & DOT', 'Mud flap hanger'], ['Mud flaps & DOT', 'Conspicuity tape (roll)', 'roll'], ['Mud flaps & DOT', 'Reflector'],
    ['Shop supplies', 'Chassis grease (tube)', 'tube'], ['Shop supplies', 'Zip ties', 'box'], ['Shop supplies', 'Hose clamp'], ['Shop supplies', 'Nuts & bolts assortment', 'box']
  ];

  /* ---------- server ---------- */
  async function rpc(fn, args) {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000);
    let r;
    try { r = await fetch(RPC + fn, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ p_token: token() }, args || {})), cache: 'no-store', signal: ctrl.signal }); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'Shop inventory took too long to answer. Try again.' : 'No connection to shop inventory.'); }
    finally { clearTimeout(t); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || ('Request failed (' + r.status + ')'));
    if (j && j.ok === false) {
      if (j.error === 'signed_out') throw new Error('Your sign-in ended. Sign out and back in, then try again.');
      throw new Error(j.error || 'Request failed');
    }
    return j;
  }

  /* ---------- helpers ---------- */
  const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
  const fmtQ = v => { const n = num(v); return n === null ? '' : (Math.round(n * 100) / 100).toLocaleString(); };
  const money = v => { const n = num(v); return n === null ? '' : '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const fmtD = d => d ? new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' }) : '';
  const fmtDT = d => d ? new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const daysSince = d => d ? (Date.now() - new Date(d).getTime()) / 864e5 : Infinity;
  const label = p => p.description + (p.part_no ? ' · ' + p.part_no : '');
  const KIND = { use: 'Used', receive: 'Received', adjust: 'Adjusted', count: 'Counted', import: 'Imported', transfer: 'Moved' };
  function msg(text, cls) { const m = $('siMsg'); m.hidden = !text; m.className = 'si-msg ' + (cls || ''); m.innerHTML = text || ''; }

  /* ---------- locations ---------- */
  const locName = c => (st.locs.find(l => l.code === c) || { name: c }).name;
  const locShort = c => (st.locs.find(l => l.code === c) || { short: c }).short;
  const stockAt = (p, c) => (p.stock || []).find(s => s.loc === c) || null;
  const totalOf = p => (p.stock || []).reduce((a, s) => a + Number(s.on_hand || 0), 0);
  // which stock rows count for the current filter ('' = every location)
  const rowsFor = (p, c) => (p.stock || []).filter(s => !c || s.loc === c);
  const isLow = (p, c) => rowsFor(p, c).some(s => s.low);
  const isUncounted = (p, c) => rowsFor(p, c).some(s => !s.counted_at);
  const oldestCount = (p, c) => { const r = rowsFor(p, c); if (!r.length || r.some(s => !s.counted_at)) return null; return r.map(s => s.counted_at).sort()[0]; };
  function locOptions() {
    document.querySelectorAll('select.si-locsel').forEach(sel => {
      const v = sel.value, all = sel.dataset.all;
      sel.innerHTML = (all ? `<option value="">${esc(all)}</option>` : '') + st.locs.map(l => `<option value="${l.code}">${esc(l.name)}</option>`).join('');
      if ([...sel.options].some(o => o.value === v)) sel.value = v;
    });
  }
  function locFromText(t) {
    const s = String(t || '').trim().toLowerCase(); if (!s) return '';
    const hit = st.locs.find(l => [l.code, l.name, l.short].some(x => String(x).toLowerCase() === s));
    if (hit) return hit.code;
    if (/off|build|yard|portable|site/.test(s)) return 'OFFSITE';
    if (/shop|main/.test(s)) return 'SHOP';
    return '';
  }

  function index() {
    st.byId = {}; st.labels = {};
    const seen = {};
    st.parts.forEach(p => {
      st.byId[p.id] = p;
      let l = label(p); if (seen[l]) l += ' #' + p.id; seen[l] = 1;
      p._label = l; if (p.active) st.labels[l.toLowerCase()] = p.id;
      p._total = totalOf(p);
    });
    $('siPartList').innerHTML = st.parts.filter(p => p.active).map(p => `<option value="${esc(p._label)}">`).join('');
    const cats = [...new Set(CATS.concat(st.parts.map(p => p.category).filter(Boolean)))].sort();
    const used = [...new Set(st.parts.map(p => p.category).filter(Boolean))].sort();
    $('siCatList').innerHTML = cats.map(c => `<option value="${esc(c)}">`).join('');
    ['siFCat', 'siCntCat'].forEach(id => { const s = $(id), v = s.value; s.innerHTML = '<option value="">All categories</option>' + used.map(c => `<option>${esc(c)}</option>`).join('') + (st.parts.some(p => !p.category) ? '<option value="-">(no category)</option>' : ''); s.value = v; });
    $('siVendorList').innerHTML = [...new Set(st.parts.map(p => p.vendor).filter(Boolean))].sort().map(v => `<option value="${esc(v)}">`).join('');
  }
  const partFromLabel = v => st.labels[String(v || '').trim().toLowerCase()] || null;

  /* ---------- load ---------- */
  async function load(quiet) {
    try {
      const j = await rpc('shop_inv_list');
      st.parts = j.parts || []; st.locs = j.locations || []; st.loaded = true;
      locOptions(); index(); badge();
      msg('');
      if (!quiet) renderTab();
    } catch (e) {
      if (!quiet) { msg(esc(e.message), 'err'); $('siTable').querySelector('tbody').innerHTML = ''; }
    }
  }
  function badge() {
    const n = st.parts.filter(p => p.active && isLow(p, '')).length;
    if (window.TMApp) TMApp.setBadge('shop', n);
  }
  function open() {
    if (!token()) { msg('Sign in to Transportation Manager first.', 'err'); return; }
    if (!st.loaded) { $('siTable').querySelector('tbody').innerHTML = '<tr><td class="muted">Loading…</td></tr>'; load(); }
    else renderTab();
  }
  function refresh() { st.movesDays = 0; return load(); }
  function peek() { if (token()) load(true); }

  /* ---------- tabs ---------- */
  const VIEWS = { stock: 'siStock', receive: 'siReceive', count: 'siCountV', activity: 'siActivity', import: 'siImport' };
  function tab(t) {
    st.tab = t;
    document.querySelectorAll('#siTabs .tab').forEach(b => b.classList.toggle('active', b.dataset.sitab === t));
    Object.keys(VIEWS).forEach(k => { $(VIEWS[k]).hidden = k !== t; });
    renderTab();
  }
  function renderTab() {
    if (!st.loaded) return;
    if (st.tab === 'stock') renderStock();
    if (st.tab === 'receive' && !$('siRcvLines').children.length) { rcvLine(); rcvLine(); rcvLine(); }
    if (st.tab === 'count') renderCount();
    if (st.tab === 'activity') loadActivity();
  }

  /* ---------- stock ---------- */
  function filtered() {
    const q = $('siSearch').value.trim().toLowerCase(), cat = $('siFCat').value, show = $('siFShow').value, loc = $('siFLoc').value;
    return st.parts.filter(p => {
      if (show === 'inactive') { if (p.active) return false; }
      else if (show !== 'all' && !p.active) return false;
      if (loc && !stockAt(p, loc) && show !== 'all') return false;
      if (show === 'low' && !isLow(p, loc)) return false;
      if (show === 'uncounted' && !isUncounted(p, loc)) return false;
      if (show === 'out' && !rowsFor(p, loc).some(s => Number(s.on_hand) <= 0)) return false;
      if (cat === '-' ? p.category : cat && p.category !== cat) return false;
      if (q && ![p.description, p.part_no, p.vendor, p.category].concat((p.stock || []).map(s => s.bin)).some(v => v && String(v).toLowerCase().includes(q))) return false;
      return true;
    });
  }
  function sortVal(p, key) {
    const loc = $('siFLoc').value;
    if (key.startsWith('loc:')) { const s = stockAt(p, key.slice(4)); return s ? Number(s.on_hand) : null; }
    if (key === 'total') return loc ? (stockAt(p, loc) ? Number(stockAt(p, loc).on_hand) : null) : p._total;
    if (key === 'counted') { const c = oldestCount(p, loc); return c ? new Date(c).getTime() : 0; }
    if (key === 'used_90') return Number(p.used_90 || 0);
    return p[key];
  }
  function stockCell(s, p) {
    if (!s) return '<td class="num si-na">—</td>';
    const oh = Number(s.on_hand);
    return `<td class="num"><b class="${oh <= 0 ? 'si-zero' : s.low ? 'si-lowt' : ''}">${fmtQ(oh)}</b>${s.low ? ' <span class="si-flag">LOW</span>' : ''}${!s.counted_at ? ' <span class="si-q" title="Not counted yet">?</span>' : ''}
      <small class="si-bin">${esc([s.bin ? 'Bin ' + s.bin : '', s.reorder_point !== null && s.reorder_point !== undefined ? 'min ' + fmtQ(s.reorder_point) : ''].filter(Boolean).join(' · '))}</small></td>`;
  }
  function renderStock() {
    const loc = $('siFLoc').value;
    const act = st.parts.filter(p => p.active && (!loc || stockAt(p, loc)));
    $('siKParts').textContent = act.length;
    $('siKLow').textContent = act.filter(p => isLow(p, loc)).length;
    $('siKUncounted').textContent = act.filter(p => isUncounted(p, loc)).length;
    const val = act.reduce((a, p) => a + (num(p.unit_cost) ? rowsFor(p, loc).reduce((b, s) => b + Math.max(0, Number(s.on_hand)) * p.unit_cost, 0) : 0), 0);
    $('siKValue').textContent = val ? '$' + Math.round(val).toLocaleString() : '--';
    const locCols = loc ? st.locs.filter(l => l.code === loc) : st.locs;
    $('siTable').querySelector('thead').innerHTML = '<tr><th data-sort="description">Part</th><th data-sort="category">Category</th>' +
      locCols.map(l => `<th data-sort="loc:${l.code}" class="num">${esc(l.name)}</th>`).join('') +
      (loc ? '' : '<th data-sort="total" class="num">Total</th>') + '<th data-sort="used_90" class="num">Used 90 days</th><th data-sort="counted">Last counted</th></tr>';
    const { key, asc } = st.sort;
    const rows = filtered().sort((a, b) => {
      let x = sortVal(a, key), y = sortVal(b, key);
      if (x === null || x === undefined || x === '') return 1; if (y === null || y === undefined || y === '') return -1;
      if (typeof x === 'string') { x = x.toLowerCase(); y = String(y).toLowerCase(); }
      return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
    });
    document.querySelectorAll('#siTable th[data-sort]').forEach(th => { th.classList.toggle('sorted', th.dataset.sort === key); th.classList.toggle('asc', th.dataset.sort === key && asc); });
    $('siCount').textContent = rows.length + ' of ' + st.parts.length;
    const ncol = 4 + locCols.length + (loc ? 0 : 1);
    $('siTable').querySelector('tbody').innerHTML = rows.length ? rows.map(p => {
      const cls = !p.active ? 'si-off' : isUncounted(p, loc) ? 'si-unc' : isLow(p, loc) ? 'si-low' : '';
      const oc = oldestCount(p, loc);
      return `<tr data-part="${p.id}" class="${cls}">
        <td><b>${esc(p.description)}</b>${p.part_no ? `<small class="si-pn">${esc(p.part_no)}</small>` : ''}${!p.active ? ' <span class="badge b-Closed">Inactive</span>' : ''}</td>
        <td>${esc(p.category || '')}</td>${locCols.map(l => stockCell(stockAt(p, l.code), p)).join('')}
        ${loc ? '' : `<td class="num"><b>${fmtQ(p._total)}</b> <small>${esc(p.uom && p.uom !== 'each' ? p.uom : '')}</small></td>`}
        <td class="num">${Number(p.used_90) ? fmtQ(p.used_90) : ''}</td>
        <td>${oc ? esc(fmtD(oc)) : (p.stock || []).length ? '<span class="si-unc-t">Not counted</span>' : '<span class="muted">Not kept anywhere</span>'}</td></tr>`;
    }).join('') : `<tr><td colspan="${ncol}" class="muted">${st.parts.length ? 'Nothing matches.' : 'No parts yet. Use <b>+ Add part</b>, or the <b>Import</b> tab to load a list.'}</td></tr>`;
  }
  function exportCsv() {
    const head = ['Part #', 'Description', 'Category', 'Unit'];
    st.locs.forEach(l => head.push(l.name + ' on hand', l.name + ' bin', l.name + ' reorder at', l.name + ' last counted'));
    head.push('Total on hand', 'Unit cost', 'Stock value', 'Vendor', 'Usually order', 'Used 90 days', 'Active', 'Notes');
    TS.csv('shop-inventory-' + new Date().toLocaleDateString('en-CA') + '.csv', head, filtered().map(p => {
      const r = [p.part_no, p.description, p.category, p.uom];
      st.locs.forEach(l => { const s = stockAt(p, l.code); r.push(s ? s.on_hand : '', s ? s.bin : '', s ? s.reorder_point : '', s && s.counted_at ? new Date(s.counted_at).toLocaleDateString('en-CA') : ''); });
      r.push(p._total, p.unit_cost, num(p.unit_cost) !== null ? (p.unit_cost * p._total).toFixed(2) : '', p.vendor, p.reorder_qty, p.used_90, p.active ? 'Yes' : 'No', p.notes);
      return r;
    }));
  }

  /* ---------- part modal ---------- */
  function locRows(p) {
    $('sfLocs').innerHTML = st.locs.map(l => {
      const s = p ? stockAt(p, l.code) : null, kept = p ? !!s : l.code === 'SHOP';
      return `<div class="si-locrow" data-loc="${l.code}">
        <label class="si-kept"><input type="checkbox" class="lk" ${kept ? 'checked' : ''}> <b>${esc(l.name)}</b></label>
        <div><label class="lbl">Bin / shelf</label><input class="lb" maxlength="40" value="${esc(s && s.bin || '')}" placeholder="e.g. A-3"></div>
        <div><label class="lbl">Reorder at</label><input class="lr" type="number" inputmode="decimal" min="0" step="any" value="${s && s.reorder_point !== null && s.reorder_point !== undefined ? esc(s.reorder_point) : ''}"></div>
        <div>${s ? `<label class="lbl">On hand</label><div class="si-ohv"><b>${fmtQ(s.on_hand)}</b>${s.counted_at ? '' : ' <span class="si-unc-t">not counted</span>'}</div>`
                  : `<label class="lbl">On hand now</label><input class="lq" type="number" inputmode="decimal" min="0" step="any" placeholder="Blank = not counted">`}</div>
      </div>`;
    }).join('');
    $('sfLocs').querySelectorAll('.si-locrow').forEach(r => {
      const sync = () => r.classList.toggle('off', !r.querySelector('.lk').checked);
      r.querySelector('.lk').addEventListener('change', sync); sync();
    });
  }
  function edit(p) {
    st.editing = p || null;
    $('siModalTitle').textContent = p ? p.description : 'Add part';
    const v = (id, x) => { $(id).value = x === null || x === undefined ? '' : x; };
    v('sfDesc', p && p.description); v('sfNo', p && p.part_no); v('sfCat', p && p.category); v('sfUom', p ? p.uom : 'each');
    v('sfReorderQty', p && p.reorder_qty); v('sfCost', p && p.unit_cost); v('sfVendor', p && p.vendor);
    v('sfNotes', p && p.notes); $('sfActive').value = p && !p.active ? 'false' : 'true';
    locRows(p);
    $('sfMeta').textContent = p && p.updated_at ? 'Last changed ' + fmtDT(p.updated_at) + (p.updated_by ? ' by ' + p.updated_by : '') : '';
    $('sfStockBox').hidden = !p;
    if (p) {
      onHand(p); $('sfAdjKind').value = 'count'; v('sfAdjQty', ''); v('sfAdjNote', '');
      const kept = (p.stock || [])[0]; $('sfAdjLoc').value = ($('siFLoc').value && stockAt(p, $('siFLoc').value)) ? $('siFLoc').value : (kept ? kept.loc : 'SHOP');
      adjKind(); history(p);
    }
    $('siModal').showModal();
    setTimeout(() => (p ? $('sfAdjQty') : $('sfDesc')).focus(), 50);
  }
  function onHand(p) {
    const rows = st.locs.map(l => {
      const s = stockAt(p, l.code);
      if (!s) return `<div class="si-oh-l off"><span>${esc(l.name)}</span><b>—</b><small>not kept here</small></div>`;
      return `<div class="si-oh-l${s.low ? ' low' : ''}"><span>${esc(l.name)}</span><b>${fmtQ(s.on_hand)}</b><small>${esc(p.uom || 'each')}${s.bin ? ' · bin ' + esc(s.bin) : ''}${s.low ? ' · <span class="si-flag">LOW</span>' : ''}<br>${s.counted_at ? 'counted ' + esc(fmtD(s.counted_at)) + (s.counted_by ? ' by ' + esc(s.counted_by) : '') : '<span class="si-unc-t">not counted yet</span>'}</small></div>`;
    }).join('');
    $('sfOnHand').innerHTML = `<div class="si-oh">${rows}<div class="si-oh-l tot"><span>Total</span><b>${fmtQ(totalOf(p))}</b><small>${esc(p.uom || 'each')}</small></div></div>`;
  }
  function adjKind() {
    const t = $('sfAdjKind').value === 'transfer';
    $('sfAdjToWrap').hidden = !t;
    if (t) { const from = $('sfAdjLoc').value, other = st.locs.find(l => l.code !== from); if (other && $('sfAdjTo').value === from) $('sfAdjTo').value = other.code; }
  }
  async function history(p) {
    const box = $('sfHist'); box.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const j = await rpc('shop_inv_history', { p_part: p.id, p_days: 365 });
      const m = j.moves || [];
      box.innerHTML = m.length ? m.slice(0, 80).map(x => `<div class="si-h"><span class="si-k si-k-${x.kind}">${KIND[x.kind] || x.kind}</span><span class="si-lc si-lc-${x.loc}">${esc(locShort(x.loc))}</span>
        <b class="${x.qty < 0 ? 'neg' : 'pos'}">${x.qty > 0 ? '+' : ''}${fmtQ(x.qty)}</b><span class="muted">→ ${fmtQ(x.on_hand_after)}</span>
        <span class="si-h-d">${esc(fmtDT(x.at))} · ${esc(x.tech || x.by || '')}${x.trailer ? ' · Trailer ' + esc(x.trailer) : ''}${x.wo_number ? ' · WO ' + esc(x.wo_number) : ''}${x.po_number ? ' · PO ' + esc(x.po_number) : ''}${x.note ? ' · ' + esc(x.note) : ''}</span></div>`).join('')
        : '<p class="muted">No stock changes yet.</p>';
    } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  }
  async function savePart(ev) {
    ev.preventDefault();
    const p = st.editing;
    const stock = [...$('sfLocs').querySelectorAll('.si-locrow')].map(r => ({ loc: r.dataset.loc, kept: r.querySelector('.lk').checked,
      bin: r.querySelector('.lb').value, reorder_point: r.querySelector('.lr').value, on_hand: r.querySelector('.lq') ? r.querySelector('.lq').value : '' }));
    if (p) {
      const blocked = stock.filter(s => !s.kept && stockAt(p, s.loc) && Number(stockAt(p, s.loc).on_hand) !== 0);
      if (blocked.length) { TS.toast(`There are still some at ${blocked.map(s => locName(s.loc)).join(', ')}. Count it to 0 or move them first.`, 'err'); return; }
    }
    const body = { id: p ? p.id : null, description: $('sfDesc').value, part_no: $('sfNo').value, category: $('sfCat').value,
      uom: $('sfUom').value, reorder_qty: $('sfReorderQty').value, unit_cost: $('sfCost').value,
      vendor: $('sfVendor').value, notes: $('sfNotes').value, active: $('sfActive').value === 'true', stock };
    const btn = $('sfSave'); TS.setBusyBtn(btn, true, 'Saving…');
    try {
      await rpc('shop_inv_save_part', { p_part: body });
      $('siModal').close();
      TS.toast((p ? 'Saved ' : 'Added ') + body.description.trim(), 'ok');
      await load();
    } catch (e) { TS.toast(e.message, 'err'); }
    finally { TS.setBusyBtn(btn, false); }
  }
  async function applyAdj() {
    const p = st.editing; if (!p) return;
    const kind = $('sfAdjKind').value, q = $('sfAdjQty').value.trim(), loc = $('sfAdjLoc').value;
    if (q === '' || isNaN(Number(q))) { TS.toast('Type a quantity.', 'err'); return; }
    if (kind !== 'adjust' && Number(q) < 0) { TS.toast('Use a number 0 or more.', 'err'); return; }
    if (kind === 'transfer' && $('sfAdjTo').value === loc) { TS.toast('Pick a different location to move them to.', 'err'); return; }
    const btn = $('sfAdjGo'); TS.setBusyBtn(btn, true, '…');
    try {
      await rpc('shop_inv_move', { p_kind: kind, p_lines: [{ part_id: p.id, loc, to_loc: $('sfAdjTo').value, qty: Number(q), note: $('sfAdjNote').value.trim() || null }], p_info: {} });
      await load(true);
      const np = st.byId[p.id]; st.editing = np; onHand(np); locRows(np); history(np);
      $('sfAdjQty').value = ''; $('sfAdjNote').value = '';
      TS.toast(kind === 'transfer' ? `Moved ${fmtQ(q)} to ${locName($('sfAdjTo').value)}.` : 'Stock updated.', 'ok');
      renderTab();
    } catch (e) { TS.toast(e.message, 'err'); }
    finally { TS.setBusyBtn(btn, false); }
  }

  /* ---------- receive ---------- */
  function rcvLine() {
    const row = document.createElement('div'); row.className = 'si-line';
    row.innerHTML = '<input class="lp" list="siPartList" placeholder="Start typing a part…" autocomplete="off"><input class="lq" type="number" inputmode="decimal" min="0" step="any" placeholder="Qty"><input class="lc" type="number" inputmode="decimal" min="0" step="0.01" placeholder="$ each"><button type="button" class="part-del" aria-label="Remove line">✕</button><small class="li"></small>';
    const lp = row.querySelector('.lp');
    lp.addEventListener('input', () => rcvInfo(row));
    row.querySelector('.part-del').onclick = () => row.remove();
    $('siRcvLines').appendChild(row);
  }
  function rcvInfo(row) {
    const lp = row.querySelector('.lp'), info = row.querySelector('.li');
    const id = partFromLabel(lp.value), p = id && st.byId[id], s = p && stockAt(p, $('siRcvLoc').value);
    row.classList.toggle('bad', !!lp.value.trim() && !p);
    info.textContent = p ? `${locName($('siRcvLoc').value)}: ${s ? fmtQ(s.on_hand) + ' on hand' + (s.bin ? ' · bin ' + s.bin : '') : 'not kept here yet (receiving adds it)'}${p.unit_cost ? ' · last cost ' + money(p.unit_cost) : ''}` : lp.value.trim() ? 'Not on the list. Pick one from the list, or add it on the Stock tab first.' : '';
    if (p && !row.querySelector('.lc').value && p.unit_cost) row.querySelector('.lc').placeholder = money(p.unit_cost);
  }
  async function saveReceive() {
    const lines = [], bad = [];
    document.querySelectorAll('#siRcvLines .si-line').forEach(r => {
      const txt = r.querySelector('.lp').value.trim(), q = r.querySelector('.lq').value, c = r.querySelector('.lc').value;
      if (!txt && !q) return;
      const id = partFromLabel(txt);
      if (!id || !(Number(q) > 0)) { bad.push(txt || '(blank part)'); return; }
      lines.push({ part_id: id, qty: Number(q), unit_cost: c === '' ? null : Number(c) });
    });
    if (bad.length) { TS.toast('Check these lines: ' + bad.join(', ') + '. Each needs a part from the list and a qty.', 'err'); return; }
    if (!lines.length) { TS.toast('Add at least one part and qty.', 'err'); return; }
    const loc = $('siRcvLoc').value;
    const btn = $('siRcvSave'); TS.setBusyBtn(btn, true, 'Saving…');
    try {
      const j = await rpc('shop_inv_move', { p_kind: 'receive', p_lines: lines, p_info: { loc, po_number: $('siRcvPo').value.trim() || null, vendor: $('siRcvVendor').value.trim() || null, note: $('siRcvNote').value.trim() || null } });
      TS.toast(`Received ${j.lines} line${j.lines === 1 ? '' : 's'} at ${locName(loc)}.`, 'ok');
      $('siRcvLines').innerHTML = ''; ['siRcvPo', 'siRcvVendor', 'siRcvNote'].forEach(id => { $(id).value = ''; });
      rcvLine(); rcvLine(); rcvLine();
      st.movesDays = 0; await load(true);
    } catch (e) { TS.toast(e.message, 'err'); }
    finally { TS.setBusyBtn(btn, false); }
  }

  /* ---------- count ---------- */
  const cntVals = {};   // key `${loc}|${partId}`
  function renderCount() {
    const loc = $('siCntLoc').value, cat = $('siCntCat').value, show = $('siCntShow').value, q = $('siCntSearch').value.trim().toLowerCase();
    const rows = st.parts.filter(p => {
      if (!p.active) return false;
      const s = stockAt(p, loc);
      if (show !== 'all' && !s) return false;
      if (show === 'uncounted' && s.counted_at) return false;
      if (show === 'old' && daysSince(s.counted_at) <= 30) return false;
      if (cat === '-' ? p.category : cat && p.category !== cat) return false;
      return !q || [p.description, p.part_no, s && s.bin].some(v => v && String(v).toLowerCase().includes(q));
    }).map(p => ({ p, s: stockAt(p, loc) }))
      .sort((a, b) => String(a.s && a.s.bin || '~').localeCompare(String(b.s && b.s.bin || '~'), undefined, { numeric: true }) || a.p.description.localeCompare(b.p.description));
    $('siCntList').innerHTML = rows.length ? rows.map(({ p, s }) => `<div class="si-cnt"><div><b>${esc(p.description)}</b><small>${esc([p.part_no, s && s.bin ? 'Bin ' + s.bin : '', p.category].filter(Boolean).join(' · '))}</small>
        <small>${s ? `System says ${fmtQ(s.on_hand)} ${esc(p.uom || '')}${s.counted_at ? ' · counted ' + esc(fmtD(s.counted_at)) : ' · never counted'}` : `Not kept at ${esc(locName(loc))} yet. A count adds it.`}</small></div>
        <input type="number" inputmode="decimal" min="0" step="any" data-cnt="${loc}|${p.id}" placeholder="Count" value="${cntVals[loc + '|' + p.id] !== undefined ? esc(cntVals[loc + '|' + p.id]) : ''}"></div>`).join('')
      : `<p class="muted">${show === 'uncounted' ? `Everything kept at ${esc(locName(loc))} has been counted. Switch Show to Everything to recount.` : 'Nothing matches.'}</p>`;
    const pending = Object.keys(cntVals).filter(k => cntVals[k] !== '').length;
    $('siCntSave').textContent = pending ? `Save count (${pending})` : 'Save count';
  }
  async function saveCount() {
    const keys = Object.keys(cntVals).filter(k => cntVals[k] !== '' && !isNaN(Number(cntVals[k])) && Number(cntVals[k]) >= 0);
    const lines = keys.map(k => { const [loc, id] = k.split('|'); return { part_id: Number(id), loc, qty: Number(cntVals[k]) }; });
    if (!lines.length) { TS.toast('Type a count on at least one line.', 'err'); return; }
    const diffs = lines.filter(l => { const s = st.byId[l.part_id] && stockAt(st.byId[l.part_id], l.loc); return !s || Number(s.on_hand) !== l.qty; }).length;
    const where = [...new Set(lines.map(l => locName(l.loc)))].join(' and ');
    if (!confirm(`Save ${lines.length} count${lines.length === 1 ? '' : 's'} at ${where}?${diffs ? ` ${diffs} will change on hand.` : ''}`)) return;
    const btn = $('siCntSave'); TS.setBusyBtn(btn, true, 'Saving…');
    try {
      const j = await rpc('shop_inv_move', { p_kind: 'count', p_lines: lines, p_info: { note: 'Physical count' } });
      keys.forEach(k => delete cntVals[k]);
      TS.toast(`Saved ${j.lines} count${j.lines === 1 ? '' : 's'}.`, 'ok');
      st.movesDays = 0; await load(true);
    } catch (e) { TS.toast(e.message, 'err'); }
    finally { TS.setBusyBtn(btn, false); renderCount(); }
  }

  /* ---------- activity ---------- */
  async function loadActivity() {
    const days = Number($('siActDays').value);
    if (st.movesDays !== days) {
      $('siActTable').querySelector('tbody').innerHTML = '<tr><td colspan="9" class="muted">Loading…</td></tr>';
      try { const j = await rpc('shop_inv_history', { p_part: null, p_days: days }); st.moves = j.moves || []; st.movesDays = days; }
      catch (e) { $('siActTable').querySelector('tbody').innerHTML = `<tr><td colspan="9" class="muted">${esc(e.message)}</td></tr>`; return; }
    }
    renderActivity();
  }
  function actFiltered() {
    const k = $('siActKind').value, q = $('siActSearch').value.trim().toLowerCase(), loc = $('siActLoc').value;
    return st.moves.filter(m => (!k || m.kind === k || (k === 'count' && m.kind === 'import')) && (!loc || m.loc === loc)
      && (!q || [m.description, m.part_no, m.trailer, m.wo_number, m.tech, m.by, m.po_number, m.vendor, m.note].some(v => v && String(v).toLowerCase().includes(q))));
  }
  function renderActivity() {
    const rows = actFiltered(), loc = $('siActLoc').value;
    const base = st.moves.filter(m => !loc || m.loc === loc);
    const used = {}; let usedCost = 0, rcvCost = 0;
    base.forEach(m => {
      if (m.kind === 'use') { const u = used[m.part_id] || (used[m.part_id] = { d: m.description, q: 0 }); u.q -= m.qty; usedCost -= m.qty * (m.unit_cost || 0); }
      if (m.kind === 'receive') rcvCost += m.qty * (m.unit_cost || 0);
    });
    const top = Object.values(used).filter(u => u.q > 0).sort((a, b) => b.q - a.q).slice(0, 8);
    const trailers = new Set(base.filter(m => m.kind === 'use' && m.trailer).map(m => m.trailer)).size;
    const byLoc = st.locs.map(l => { const c = st.moves.filter(m => m.kind === 'use' && m.loc === l.code).reduce((a, m) => a - m.qty * (m.unit_cost || 0), 0); return c ? `${esc(l.short)} $${Math.round(c).toLocaleString()}` : ''; }).filter(Boolean).join(' · ');
    $('siActSum').innerHTML = `<div class="kpis"><div class="kpi"><b>${trailers}</b><span>Trailers with parts used</span></div>
      <div class="kpi red"><b>${usedCost ? '$' + Math.round(usedCost).toLocaleString() : '--'}</b><span>Parts used (at cost)${!loc && byLoc ? '<br>' + byLoc : ''}</span></div>
      <div class="kpi green"><b>${rcvCost ? '$' + Math.round(rcvCost).toLocaleString() : '--'}</b><span>Received (at cost)</span></div>
      <div class="kpi"><b class="kpi-text">${top.length ? esc(top[0].d) : '--'}</b><span>Most used</span></div></div>` +
      (top.length > 1 ? `<div class="si-top"><b>Most used:</b> ${top.map(u => `${esc(u.d)} <span class="muted">×${fmtQ(u.q)}</span>`).join(' · ')}</div>` : '');
    $('siActCount').textContent = rows.length + (st.moves.length === 3000 ? ' (newest 3,000)' : '');
    $('siActTable').querySelector('tbody').innerHTML = rows.length ? rows.slice(0, 600).map(m => `<tr>
      <td>${esc(fmtDT(m.at))}</td><td><span class="si-k si-k-${m.kind}">${KIND[m.kind] || m.kind}</span></td><td><span class="si-lc si-lc-${m.loc}">${esc(locShort(m.loc))}</span></td>
      <td>${esc(m.description)}${m.part_no ? `<small class="si-pn">${esc(m.part_no)}</small>` : ''}</td>
      <td class="num"><b class="${m.qty < 0 ? 'neg' : 'pos'}">${m.qty > 0 ? '+' : ''}${fmtQ(m.qty)}</b></td><td class="num">${fmtQ(m.on_hand_after)}</td>
      <td>${m.trailer ? 'Trailer ' + esc(m.trailer) : ''}${m.wo_number ? `<small class="si-pn">WO ${esc(m.wo_number)}</small>` : ''}${m.po_number ? 'PO ' + esc(m.po_number) : ''}</td>
      <td>${esc(m.tech || m.by || '')}</td><td>${esc([m.vendor, m.note].filter(Boolean).join(' · '))}</td></tr>`).join('')
      : '<tr><td colspan="9" class="muted">No stock activity in this period.</td></tr>';
  }
  function actCsv() {
    TS.csv('shop-stock-activity-' + new Date().toLocaleDateString('en-CA') + '.csv',
      ['Date', 'Type', 'Location', 'Part #', 'Description', 'Category', 'Change', 'On hand after', 'Unit cost', 'Trailer', 'WO', 'Tech / by', 'PO', 'Vendor', 'Note'],
      actFiltered().map(m => [new Date(m.at).toLocaleString(), KIND[m.kind] || m.kind, locName(m.loc), m.part_no, m.description, m.category, m.qty, m.on_hand_after, m.unit_cost, m.trailer, m.wo_number, m.tech || m.by, m.po_number, m.vendor, m.note]));
  }

  /* ---------- import ---------- */
  function parseRows(text) {
    text = String(text || '').replace(/\r\n?/g, '\n').replace(/^﻿/, '');
    const first = text.split('\n')[0] || '';
    const sep = first.includes('\t') ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"' && cell === '') q = true;
      else if (c === sep) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }
  const MAP = [
    ['part_no', /^(part|item)?\s*(#|no\.?|num(ber)?)$|^part\s*(#|no|number)|^sku$|^p\/?n$/i],
    ['description', /desc|^item$|^part$|^part name$|^name$|^product/i],
    ['category', /categ|^type$|^group$|^class/i],
    ['loc', /^(location|site|building|where|shop)$/i],
    ['bin', /^bin|shelf|^rack|^loc(ation)?\s*(in|bin)/i],
    ['qty', /^(qty|quantity|on\s*hand|count|in\s*stock|stock|onhand|amount|#\s*on\s*hand)/i],
    ['unit_cost', /cost|price|\$/i],
    ['reorder_point', /reorder|^min|minimum|par/i],
    ['vendor', /vendor|supplier|source/i],
    ['uom', /^(uom|unit|units|u\/m)$/i]
  ];
  function mapHeader(h) {
    const out = {};
    h.forEach((c, i) => { const t = String(c).trim(); const m = MAP.find(([k, re]) => !(k in out) && re.test(t)); if (m) out[m[0]] = i; });
    return out;
  }
  function preview() {
    const rows = parseRows($('siImpText').value), box = $('siImpPreview');
    st.imp = [];
    if (rows.length < 2) { box.innerHTML = rows.length ? '<p class="muted">Include the header row and at least one part.</p>' : ''; $('siImpSave').disabled = true; return; }
    const cols = mapHeader(rows[0]);
    if (!('description' in cols) && !('part_no' in cols)) {
      box.innerHTML = `<p class="si-err">Couldn't find a description or part # column. Headers found: ${rows[0].map(c => esc(c)).join(', ')}. Rename one column to <b>Description</b>.</p>`;
      $('siImpSave').disabled = true; return;
    }
    const def = $('siImpLoc').value;
    const cleanNum = v => { const s = String(v == null ? '' : v).replace(/[$,\s]/g, ''); return s === '' || isNaN(Number(s)) ? '' : s; };
    let unknownLoc = 0;
    st.imp = rows.slice(1).map(r => {
      const g = k => (k in cols ? String(r[cols[k]] == null ? '' : r[cols[k]]).trim() : '');
      const raw = g('loc'), lc = locFromText(raw);
      if (raw && !lc) unknownLoc++;
      return { part_no: g('part_no'), description: g('description') || g('part_no'), category: g('category'), loc: lc || def, bin: g('bin'), uom: g('uom'),
        qty: cleanNum(g('qty')), unit_cost: cleanNum(g('unit_cost')), reorder_point: cleanNum(g('reorder_point')), vendor: g('vendor') };
    }).filter(r => r.description);
    const known = r => (r.part_no && st.parts.some(p => p.part_no && p.part_no.toUpperCase() === r.part_no.toUpperCase())) || st.parts.some(p => p.description.toLowerCase() === r.description.toLowerCase());
    const nNew = st.imp.filter(r => !known(r)).length;
    const names = { part_no: 'Part #', description: 'Description', category: 'Category', loc: 'Location', bin: 'Bin', qty: 'Qty', unit_cost: 'Cost', reorder_point: 'Reorder at', vendor: 'Vendor', uom: 'Unit' };
    const perLoc = st.locs.map(l => { const n = st.imp.filter(r => r.loc === l.code).length; return n ? `${n} at ${esc(l.name)}` : ''; }).filter(Boolean).join(', ');
    box.innerHTML = `<div class="info"><b>${st.imp.length}</b> rows: <b>${nNew}</b> new parts, the rest already on the list (they will be updated). ${perLoc}. Columns used: ${Object.keys(cols).map(k => names[k]).join(', ')}.${unknownLoc ? ` <b>${unknownLoc}</b> rows had a location that wasn't Trailer Shop or Off-Site; they go to ${esc(locName(def))}.` : ''}</div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Part #</th><th>Description</th><th>Category</th><th>Location</th><th>Bin</th><th class="num">Qty</th><th class="num">Cost</th><th class="num">Reorder</th><th>Vendor</th><th></th></tr></thead><tbody>
      ${st.imp.slice(0, 25).map(r => `<tr><td>${esc(r.part_no)}</td><td>${esc(r.description)}</td><td>${esc(r.category)}</td><td><span class="si-lc si-lc-${r.loc}">${esc(locShort(r.loc))}</span></td><td>${esc(r.bin)}</td><td class="num">${esc(r.qty)}</td><td class="num">${esc(r.unit_cost)}</td><td class="num">${esc(r.reorder_point)}</td><td>${esc(r.vendor)}</td><td>${known(r) ? '<small>update</small>' : '<small class="si-new">new</small>'}</td></tr>`).join('')}
      ${st.imp.length > 25 ? `<tr><td colspan="10" class="muted">…and ${st.imp.length - 25} more</td></tr>` : ''}</tbody></table></div>`;
    $('siImpSave').disabled = !st.imp.length;
    $('siImpSave').textContent = 'Import ' + st.imp.length + ' row' + (st.imp.length === 1 ? '' : 's');
  }
  async function saveImport() {
    if (!st.imp.length) return;
    const counts = document.querySelector('input[name="siImpMode"]:checked').value === 'counts';
    if (counts && !st.imp.some(r => r.qty !== '')) { TS.toast('There is no qty column to use as counts. Pick "Names only", or add a Qty column.', 'err'); return; }
    if (!confirm(counts ? `Import ${st.imp.length} rows and SET on hand to the qty column?` : `Import ${st.imp.length} rows as names only? Counts stay "not counted" until someone counts them.`)) return;
    const btn = $('siImpSave'); TS.setBusyBtn(btn, true, 'Importing…');
    try {
      const j = await rpc('shop_inv_import', { p_rows: st.imp, p_counts: counts, p_loc: $('siImpLoc').value });
      TS.toast(`Imported: ${j.added} new, ${j.updated} updated${counts ? ', ' + j.counted + ' counts set' : ''}.`, 'ok');
      $('siImpText').value = ''; st.imp = []; $('siImpPreview').innerHTML = ''; btn.disabled = true;
      await load(true); tab('stock');
    } catch (e) { TS.toast(e.message, 'err'); }
    finally { TS.setBusyBtn(btn, false); if (!st.imp.length) btn.disabled = true; }
  }
  function starter() {
    if ($('siImpText').value.trim() && !confirm('Replace what is in the paste box with the starter list?')) return;
    $('siImpText').value = 'Category\tDescription\tUnit\n' + STARTER.map(s => s[0] + '\t' + s[1] + '\t' + (s[2] || 'each')).join('\n');
    document.querySelector('input[name="siImpMode"][value="names"]').checked = true;
    preview();
    TS.toast(`Starter list loaded for ${locName($('siImpLoc').value)}. Delete the lines that aren't kept there, then Import.`, 'ok');
  }

  /* ---------- wiring ---------- */
  document.querySelectorAll('#siTabs .tab').forEach(b => b.onclick = () => tab(b.dataset.sitab));
  ['siSearch', 'siFCat', 'siFShow', 'siFLoc'].forEach(id => $(id).addEventListener('input', renderStock));
  $('siTable').addEventListener('click', e => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const k = th.dataset.sort; st.sort = { key: k, asc: st.sort.key === k ? !st.sort.asc : !(k.startsWith('loc:') || ['total', 'used_90', 'counted'].includes(k)) }; renderStock(); return; }
    const r = e.target.closest('[data-part]'); if (r) edit(st.byId[r.dataset.part]);
  });
  $('siAdd').onclick = () => edit(null);
  $('siCsv').onclick = exportCsv;
  $('siModalClose').onclick = () => $('siModal').close();
  $('siForm').addEventListener('submit', savePart);
  $('sfAdjGo').onclick = applyAdj;
  $('sfAdjKind').addEventListener('change', adjKind);
  $('sfAdjLoc').addEventListener('change', adjKind);
  $('siRcvAdd').onclick = rcvLine;
  $('siRcvSave').onclick = saveReceive;
  $('siRcvLoc').addEventListener('change', () => document.querySelectorAll('#siRcvLines .si-line').forEach(rcvInfo));
  ['siCntLoc', 'siCntCat', 'siCntShow', 'siCntSearch'].forEach(id => $(id).addEventListener('input', renderCount));
  $('siCntList').addEventListener('input', e => { const i = e.target.closest('[data-cnt]'); if (i) { cntVals[i.dataset.cnt] = i.value.trim(); const n = Object.keys(cntVals).filter(k => cntVals[k] !== '').length; $('siCntSave').textContent = n ? `Save count (${n})` : 'Save count'; } });
  $('siCntSave').onclick = saveCount;
  $('siActDays').addEventListener('change', loadActivity);
  ['siActKind', 'siActSearch', 'siActLoc'].forEach(id => $(id).addEventListener('input', renderActivity));
  $('siActCsv').onclick = actCsv;
  let pv = null; $('siImpText').addEventListener('input', () => { clearTimeout(pv); pv = setTimeout(preview, 250); });
  $('siImpLoc').addEventListener('change', preview);
  $('siImpFile').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader(); rd.onload = () => { $('siImpText').value = rd.result; preview(); }; rd.readAsText(f); e.target.value = '';
  });
  $('siImpStarter').onclick = starter;
  $('siImpSave').onclick = saveImport;
  window.addEventListener('beforeunload', e => { if (Object.values(cntVals).some(v => v !== '')) { e.preventDefault(); e.returnValue = ''; } });

  return { open, refresh, peek, tab };
})();
