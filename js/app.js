/* Transportation Manager — home screen, navigation, sign-ins, install. */
window.TMApp = (function () {
  'use strict';
  const { $, post, run, screen, state } = TS;
  const CFG = window.TM_CONFIG || {};
  const TRAILER_KEY = 'tm_trailer', SESSION_MS = 8 * 60 * 60 * 1000 - 5 * 60 * 1000;
  let current = 'home', mtab = 'insp', pin = '';

  const SCREENS = {
    home:       { id: 'scrHome',           title: 'Logistics Warehouse' },
    timeoff:    { id: 'scrTimeOff',        title: 'Unpaid Time Off' },
    drivers:    { id: 'scrDrivers',        title: 'Drivers' },
    trailers:   { id: 'scrMgr',            title: 'Trailer Inspections' },
    dispatch:   { id: 'yardBoard',         title: 'Dispatch Board' },
    timesheets: { id: 'spotterTimesheets', title: 'All Timesheets' },
    fuel:       { id: 'fuelboard',         title: 'Fuel Prices' },
    surcharge:  { id: 'fsc',               title: 'Fuel Surcharge' }
  };
  // Toolkit view names → ours (the copied Toolkit files call LWHUI.show)
  const ALIAS = { yardBoard: 'dispatch', spotterTimesheets: 'timesheets', fuelboard: 'fuel', fsc: 'surcharge', home: 'home' };

  /* ---------- trailer sign-in (Dashboard PIN, kept 8 hours on this device) ---------- */
  function loadTrailer() {
    try { const s = JSON.parse(localStorage.getItem(TRAILER_KEY)); return s && Date.now() - s.at < SESSION_MS ? s.token : null; } catch (e) { return null; }
  }
  function saveTrailer(token) {
    try { token ? localStorage.setItem(TRAILER_KEY, JSON.stringify({ token, at: Date.now() })) : localStorage.removeItem(TRAILER_KEY); } catch (e) {}
    state.mgrToken = token || null;
  }
  state.mgrToken = loadTrailer();

  function showPin() { pin = ''; dots(); $('pinErr').textContent = ''; setSub('Trailer Inspections'); screen('scrPin'); }
  function dots() { document.querySelectorAll('#pinDots i').forEach((d, i) => d.classList.toggle('on', i < pin.length)); }
  function press(k) {
    if (k === 'clr') pin = '';
    else if (k === 'back') pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += k;
    dots();
    if (pin.length === 4) setTimeout(trailerLogin, 120);
  }
  async function trailerLogin() {
    const p = pin;
    await run(async () => {
      try {
        const j = await post({ action: 'mgrLogin', pin: p });
        saveTrailer(j.token);
        open('trailers');
        renderSign();
      } catch (e) {
        pin = ''; dots(); $('pinErr').textContent = e.message;
        const d = $('pinDots'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake');
      }
    }, 'Checking PIN…');
  }
  function trailerSignOut() {
    post({ action: 'mgrLogout', token: state.mgrToken }).catch(() => {});
    saveTrailer(null);
    TSMgr.close(); TSMgr.reset(); TSReports.reset();
    renderSign();
    if (current === 'trailers') open('home');
  }
  // core.js calls this when the trailer server says the session ended
  function sessionExpired() { saveTrailer(null); renderSign(); if (current === 'trailers') showPin(); }

  /* ---------- trailer tabs ---------- */
  const VIEWS = { insp: 'mvInsp', an: 'mvAn', dl: 'mvDl', hist: 'mvHist', map: 'mvMap' };
  function showTab(t) {
    mtab = t;
    document.querySelectorAll('#mgrTabs .tab').forEach(b => b.classList.toggle('active', b.dataset.mtab === t));
    Object.keys(VIEWS).forEach(k => { $(VIEWS[k]).hidden = k !== t; });
    if (t === 'an') TSReports.openAnalytics();
    if (t === 'dl') TSReports.openDl();
    if (t === 'map') TSMap.open();
  }

  /* ---------- navigation ---------- */
  function setSub(t) { $('tbSub').textContent = t || 'Logistics Warehouse'; }
  function open(view, fromHash) {
    view = ALIAS[view] || view;
    if (!SCREENS[view]) view = 'home';
    current = view;
    if (!fromHash) { const h = view === 'home' ? '' : '#' + view; if (location.hash !== h) history.pushState(null, '', h || location.pathname + location.search); }
    $('btnBack').hidden = view === 'home';
    setSub(SCREENS[view].title);
    // the copied Toolkit screens load when their section gets the "active" class
    Object.values(SCREENS).forEach(s => { const el = $(s.id); if (el) el.classList.toggle('active', s.id === SCREENS[view].id); });

    if (view === 'trailers' && !state.mgrToken) return showPin();
    screen(SCREENS[view].id);
    if (view === 'home') { greet(); refreshHub(); }
    if (view === 'timeoff') TMTimeOff.open();
    if (view === 'drivers') TMDrivers.open();
    if (view === 'trailers') { showTab(mtab); if (!TSMgr.isLoaded()) TSMgr.load(); }
  }
  function refresh() {
    if (current === 'timeoff') return TMTimeOff.refresh();
    if (current === 'drivers') return TMDrivers.refresh();
    if (current === 'trailers' && !$('scrMgr').hidden) {
      if (mtab === 'insp') return TSMgr.load();
      if (mtab === 'map') return TSMap.refresh();
      return TSReports.refresh(mtab);
    }
    if (current === 'dispatch') return $('ybLoad').click();
    if (current === 'timesheets') return $('stLoadBtn').click();
    if (current === 'fuel') return $('fbRefresh').click();
    if (current === 'surcharge') return $('fscRefresh').click();
    refreshHub();
  }

  /* ---------- home ---------- */
  function greet() {
    const h = new Date().getHours();
    const name = (TMTimeOff.name() || '').split(' ')[0];
    $('hubHello').textContent = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + (name ? ', ' + name : '');
  }
  function setBadge(which, n) {
    const b = $('badge' + which.charAt(0).toUpperCase() + which.slice(1));
    if (!b) return;
    b.textContent = n; b.hidden = !n;
  }
  async function refreshHub() {
    renderSign();
    const n = await TMTimeOff.peek();
    if (n !== null) setBadge('timeoff', n);
  }
  function renderSign() {
    const parts = [];
    if (TMTimeOff.signedIn()) parts.push(`Time Off: signed in as <b>${TS.esc(TMTimeOff.name())}</b> <button class="btn outline sm" data-signout="timeoff">Sign out</button>`);
    if (state.mgrToken) parts.push('Trailers: signed in <button class="btn outline sm" data-signout="trailers">Sign out</button>');
    $('hubSign').innerHTML = parts.length ? parts.map(p => `<div>${p}</div>`).join('') : '';
    if (!TMTimeOff.signedIn()) setBadge('timeoff', 0);
  }
  function weather() {
    const names = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Fog', 51: 'Drizzle', 53: 'Drizzle', 55: 'Drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm' };
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${TS.CFG.WX_LAT}&longitude=${TS.CFG.WX_LNG}&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FChicago`)
      .then(r => r.json()).then(d => { $('hubWx').textContent = Math.round(d.current.temperature_2m) + '°F · ' + (names[d.current.weather_code] || '') + ' · Fort Smith'; })
      .catch(() => {});
  }

  /* ---------- install ---------- */
  let deferred = null;
  const installed = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  $('btnInstall').hidden = installed();
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('btnInstall').hidden = installed(); });
  window.addEventListener('appinstalled', () => { deferred = null; $('btnInstall').hidden = true; });
  $('btnInstall').onclick = async () => {
    if (deferred) { deferred.prompt(); const c = await deferred.userChoice.catch(() => null); deferred = null; if (c && c.outcome === 'accepted') $('btnInstall').hidden = true; return; }
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    $('installIos').hidden = !ios; $('installOther').hidden = ios; $('installHelp').hidden = false;
  };
  $('installClose').onclick = () => { $('installHelp').hidden = true; };

  /* ---------- wiring ---------- */
  // Links are also written into index.html, so they work even if an older config.js is cached
  if (CFG.PTO_MANAGER_URL) $('ptoLink').href = CFG.PTO_MANAGER_URL;
  if (CFG.TRACKING_URL) $('trackLink').href = CFG.TRACKING_URL;
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]'); if (g) { e.preventDefault(); open(g.dataset.go); return; }
    const s = e.target.closest('[data-signout]');
    if (s) {
      if (s.dataset.signout === 'timeoff') { if (confirm('Sign out of Time Off?')) TMTimeOff.signOut(); }
      else if (confirm('Sign out of Trailers?')) trailerSignOut();
    }
  });
  $('btnHome').onclick = () => open('home');
  $('btnBack').onclick = () => open('home');
  $('btnRefresh').onclick = refresh;
  $('keypad').addEventListener('click', e => { const b = e.target.closest('button'); if (b) press(b.dataset.k || b.textContent.trim()); });
  document.addEventListener('keydown', e => {
    if ($('scrPin').hidden) return;
    if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('back'); else if (e.key === 'Escape') press('clr');
  });
  document.querySelectorAll('#mgrTabs .tab').forEach(b => b.onclick = () => showTab(b.dataset.mtab));
  window.addEventListener('popstate', () => open(location.hash.replace('#', '') || 'home', true));

  // Start once the copied Toolkit files have wired themselves up (they use window "load")
  window.addEventListener('load', () => {
    weather();
    open(location.hash.replace('#', '') || 'home', true);
  });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

  return { open, refreshHub, setBadge, sessionExpired, managerName: () => TMTimeOff.name() };
})();
// core.js looks for TSApp.sessionExpired
window.TSApp = { sessionExpired: () => TMApp.sessionExpired(), setSub: () => {}, showSwitch: () => {} };
