/* Manager — Trailer Map (Samsara positions), ported from Dashboard.html */
window.TSMap = (function () {
  'use strict';
  const { $, mgr, toast, esc, setBusyBtn } = TS;
  const st = { map: null, layer: null, markers: [], all: [], sorted: [], loaded: false, summary: false };
  const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
  const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  // Groups trailers that are close together into one numbered square; tap it to spread them out.
  const CLUSTER_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/MarkerCluster.css';
  const CLUSTER_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.5.3/leaflet.markercluster.js';

  const minsAgo = t => t.lastSeen ? (Date.now() - new Date(t.lastSeen).getTime()) / 60000 : Infinity;
  function color(t) { const m = minsAgo(t); return m > 10080 ? '#95A5A6' : m > 1440 ? '#c8102e' : m > 120 ? '#E67E22' : m > 30 ? '#F1C40F' : '#1e7b34'; }

  function css(href) { if (!document.querySelector(`link[href="${href}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); } }
  function script(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('The map library failed to load.')); document.head.appendChild(s); }); }
  async function loadLeaflet() {
    css(LEAFLET_CSS);
    if (!window.L) await script(LEAFLET_JS);
    if (!L.markerClusterGroup) { css(CLUSTER_CSS); try { await script(CLUSTER_JS); } catch (e) { /* falls back to plain pins */ } }
  }
  // Teardrop pin in the freshness color, with the trailer number beside it
  function pinIcon(t) {
    const c = color(t), moving = t.speed > 1;
    return L.divIcon({ className: 'tm-pin', iconSize: [22, 30], iconAnchor: [11, 29], popupAnchor: [0, -26],
      html: `<svg viewBox="0 0 22 30" width="22" height="30"><path d="M11 1C5.5 1 1 5.4 1 10.9 1 18.3 11 29 11 29s10-10.7 10-18.1C21 5.4 16.5 1 11 1z" fill="${c}" stroke="#111" stroke-width="1.5"/><circle cx="11" cy="11" r="${moving ? 4.5 : 3.5}" fill="#fff"/>${moving ? '<path d="M9.3 8.6v4.8l4-2.4z" fill="' + c + '"/>' : ''}</svg>` +
        `<span class="tm-pin-lbl">${esc(String(t.name || ''))}</span>` });
  }
  function clusterIcon(cluster) {
    const n = cluster.getChildCount();
    const size = n < 10 ? 34 : n < 50 ? 40 : 46;
    return L.divIcon({ className: 'tm-cluster', iconSize: [size, size], html: `<div style="width:${size}px;height:${size}px">${n}</div>` });
  }
  async function open() {
    try { await loadLeaflet(); } catch (e) { return showErr(e.message); }
    if (!st.map) {
      st.map = L.map('mapBox').setView([35.385, -94.398], 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(st.map);
      st.layer = L.markerClusterGroup
        ? L.markerClusterGroup({ maxClusterRadius: 45, showCoverageOnHover: false, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 17, iconCreateFunction: clusterIcon })
        : L.layerGroup();
      st.layer.addTo(st.map);
    }
    if (!st.loaded) load();
    setTimeout(() => st.map && st.map.invalidateSize(), 150);
  }
  async function load() {
    const btn = $('mapRefresh'); setBusyBtn(btn, true, 'Loading…');
    $('mapCount').textContent = 'Fetching from Samsara…'; $('mapErr').hidden = true;
    try {
      const r = await mgr('getSamsaraTrailerPositions');
      if (!r || !r.success) throw new Error((r && r.message) || 'Failed to load positions.');
      st.all = r.trailers || []; st.loaded = true;
      draw(st.all);
      const n = new Date(); $('mapRefreshed').textContent = 'Updated ' + n.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) { showErr(e.message); }
    finally { setBusyBtn(btn, false); }
  }
  function draw(trailers) {
    if (!st.map) return;
    st.layer.clearLayers(); st.markers = [];
    $('mapCount').textContent = trailers.length + ' trailer' + (trailers.length === 1 ? '' : 's') + ' tracked';
    $('mapSearch').value = ''; $('mapFilter').value = 'all'; $('mapClear').hidden = true;
    const bounds = [];
    trailers.forEach(t => {
      if (!t.lat || !t.lng) return;
      const icon = pinIcon(t);
      const pop = `<div style="font-family:Arial;min-width:180px"><div style="font-weight:800;font-size:14px;margin-bottom:6px">Trailer ${esc(t.name)}</div>
        <div style="font-size:12px"><b>Location:</b> ${esc(t.address || 'Unknown')}</div><div style="font-size:12px"><b>Last seen:</b> ${esc(t.freshness)}</div>
        <div style="font-size:12px"><b>Speed:</b> ${t.speed || 0} mph</div>
        <a href="https://maps.apple.com/?ll=${t.lat},${t.lng}&q=Trailer+${encodeURIComponent(t.name)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:8px;background:#111;color:#fff;padding:5px 10px;text-decoration:none;font-size:11px;font-weight:800">VIEW ON MAPS</a></div>`;
      const m = L.marker([t.lat, t.lng], { icon, title: 'Trailer ' + (t.name || '') }).bindPopup(pop);
      m._t = t; st.markers.push(m); bounds.push([t.lat, t.lng]);
    });
    if (st.layer.addLayers) st.layer.addLayers(st.markers); else st.markers.forEach(m => st.layer.addLayer(m));
    if (bounds.length) st.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    list(trailers);
    if (st.summary) summary(trailers);
  }
  function list(trailers) {
    const box = $('mapList');
    if (!trailers.length) { box.innerHTML = '<div class="empty">No trailer positions returned.</div>'; return; }
    st.sorted = trailers.slice().sort((a, b) => !a.lastSeen ? 1 : !b.lastSeen ? -1 : new Date(b.lastSeen) - new Date(a.lastSeen));
    box.innerHTML = `<div class="panel" style="margin-top:14px"><div class="panel-h"><span>All trailers</span></div><div class="table-wrap"><table class="tbl"><thead><tr><th>Trailer</th><th>Location</th><th>Last seen</th><th>Status</th></tr></thead><tbody>` +
      st.sorted.map((t, i) => `<tr class="click" data-fly="${i}"><td><b><span class="dot" style="background:${color(t)}"></span>${esc(t.name)}</b></td><td>${esc(t.address || '--')}</td><td style="white-space:nowrap">${esc(t.freshness)}</td>
        <td>${t.speed > 1 ? `<b style="color:var(--green)">${Number(t.speed).toFixed(1)} mph</b>` : '<span class="muted">Parked</span>'}</td></tr>`).join('') +
      `</tbody></table></div></div><div class="legend"><span><span class="dot" style="background:#1e7b34"></span>&lt;30m</span><span><span class="dot" style="background:#F1C40F"></span>&lt;2h</span><span><span class="dot" style="background:#E67E22"></span>&lt;1 day</span><span><span class="dot" style="background:#c8102e"></span>&gt;1 day</span><span><span class="dot" style="background:#95A5A6"></span>&gt;1 week</span></div>`;
  }
  function matches(t, q, s) {
    if (q && (t.name || '').toLowerCase().indexOf(q) < 0 && (t.address || '').toLowerCase().indexOf(q) < 0) return false;
    if (s === 'moving') return t.speed > 1;
    if (s === 'parked') return t.speed <= 1;
    if (s === 'recent') return minsAgo(t) <= 120;
    if (s === 'stale') return minsAgo(t) > 1440;
    return true;
  }
  function filter() {
    const q = $('mapSearch').value.trim().toLowerCase(), s = $('mapFilter').value;
    $('mapClear').hidden = !(q || s !== 'all');
    const f = st.all.filter(t => matches(t, q, s));
    $('mapCount').textContent = f.length + ' of ' + st.all.length + ' trailers';
    st.layer.clearLayers();
    const on = st.markers.filter(m => matches(m._t, q, s));
    if (st.layer.addLayers) st.layer.addLayers(on); else on.forEach(m => st.layer.addLayer(m));
    list(f);
    if (f.length && f.length <= 10) { const b = f.filter(t => t.lat && t.lng).map(t => [t.lat, t.lng]); if (b.length) st.map.fitBounds(b, { padding: [40, 40], maxZoom: 15 }); }
  }
  function fly(i) {
    const t = st.sorted[i]; if (!t || !t.lat) return;
    window.scrollTo({ top: $('mapBox').offsetTop - 120, behavior: 'smooth' });
    const m = st.markers.find(x => x._t === t);
    if (m && st.layer.hasLayer(m) && st.layer.zoomToShowLayer) { st.map.setView([t.lat, t.lng], Math.max(st.map.getZoom(), 13)); st.layer.zoomToShowLayer(m, () => m.openPopup()); }
    else { st.map.flyTo([t.lat, t.lng], 15, { duration: 1.1 }); if (m) setTimeout(() => m.openPopup(), 1200); }
  }
  function city(addr) {
    if (!addr) return '';
    const p = addr.split(',').map(s => s.trim());
    for (let i = 1; i < p.length; i++) if (/^[A-Z]{2}$/.test(p[i])) return p[i - 1] + ', ' + p[i];
    return p.length >= 2 ? p[p.length - 2] + ', ' + (p[p.length - 1] || '') : addr;
  }
  function summary(trailers) {
    const box = $('mapSummary');
    if (!trailers.length) { box.innerHTML = '<div class="empty">Load the map first to see the summary.</div>'; return; }
    const g = {}, none = [];
    trailers.forEach(t => { const c = city(t.address); if (!c) none.push(t); else (g[c] = g[c] || []).push(t); });
    const keys = Object.keys(g).sort((a, b) => g[b].length - g[a].length);
    if (none.length) { keys.push('Unknown location'); g['Unknown location'] = none; }
    const moving = trailers.filter(t => t.speed > 1).length;
    box.innerHTML = `<div class="kpis"><div class="kpi"><b>${trailers.length}</b><span>Total trailers</span></div><div class="kpi"><b>${keys.length}</b><span>Locations</span></div>
      <div class="kpi green"><b>${trailers.length - moving}</b><span>Parked</span></div><div class="kpi amber"><b>${moving}</b><span>Moving</span></div></div><div class="sum-grid">` +
      keys.map(c => {
        const list = g[c].slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        const mv = list.filter(t => t.speed > 1).length, stale = list.filter(t => t.lastSeen && Date.now() - new Date(t.lastSeen) > 86400000).length;
        return `<div class="city"><div class="city-h"><div><b>${esc(c)}</b><div class="muted" style="font-size:12px">${list.length - mv} parked${mv ? ' · ' + mv + ' moving' : ''}${stale ? ' · ' + stale + ' stale' : ''}</div></div><span class="city-n">${list.length}</span></div>
          <div>${list.slice(0, 12).map(t => `<span class="tchip${t.speed > 1 ? ' mv' : ''}" data-city="${esc(c)}">${esc(t.name)}${t.speed > 1 ? ' ▶' : ''}</span>`).join('')}${list.length > 12 ? `<span class="tchip" style="background:#eee;color:#666">+${list.length - 12} more</span>` : ''}</div>
          <div style="text-align:right;margin-top:10px"><button class="btn dark sm" data-city="${esc(c)}">Show on map</button></div></div>`;
      }).join('') + '</div>';
  }
  function setView(sum) {
    st.summary = sum;
    $('mapViewMap').classList.toggle('on', !sum); $('mapViewSum').classList.toggle('on', sum);
    $('mapBox').hidden = sum; $('mapList').hidden = sum; $('mapSummary').hidden = !sum;
    if (sum) summary(st.all); else setTimeout(() => st.map && st.map.invalidateSize(), 100);
  }
  function showErr(msg) { $('mapErr').textContent = msg; $('mapErr').hidden = false; $('mapCount').textContent = 'Error loading positions'; }

  $('mapRefresh').onclick = () => { st.loaded = false; open(); };
  $('mapSearch').addEventListener('input', filter);
  $('mapFilter').addEventListener('change', filter);
  $('mapClear').onclick = () => { $('mapSearch').value = ''; $('mapFilter').value = 'all'; filter(); };
  $('mapList').addEventListener('click', e => { const r = e.target.closest('[data-fly]'); if (r) fly(+r.dataset.fly); });
  $('mapViewMap').onclick = () => setView(false);
  $('mapViewSum').onclick = () => setView(true);
  $('mapSummary').addEventListener('click', e => {
    const b = e.target.closest('[data-city]'); if (!b) return;
    setView(false); $('mapSearch').value = b.dataset.city.split(',')[0].trim(); setTimeout(filter, 150);
  });
  return { open, refresh: () => { st.loaded = false; open(); } };
})();
