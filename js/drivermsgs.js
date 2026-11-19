/* Driver Messages — the Driver Message Center (Driver Toolkit /dispatch/) shown inside this app.
   Same sign-in as before: Driver ID + 6-digit PIN for people set as Manager in the driver list.
   The page lives in the Driver Toolkit repo; this screen just hosts it, so there is one copy to maintain. */
window.TMDriverMsgs = (function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const URL_ = 'https://nbr1hawgfan.github.io/LWH_Driver_Toolkit/dispatch/?embed=1';
  const API = 'https://tjivcqxnkftujceumdtx.supabase.co/rest/v1/rpc/';
  const KEY = 'sb_publishable_PYlWSW6-Gi-QZl91IXUq0Q_W5mO3sDT';
  const TK = 'lwhdispatch_token';   // shared with the Message Center page (same site)
  const token = () => { try { return localStorage.getItem(TK) || ''; } catch (e) { return ''; } };
  let loaded = false;

  function size() {
    const f = $('dmFrame'); if (!f || $('scrMessages').hidden) return;
    const top = f.getBoundingClientRect().top + window.scrollY;
    f.style.height = Math.max(420, window.innerHeight - top) + 'px';
  }
  function open() {
    const f = $('dmFrame');
    if (!loaded) { f.src = URL_; loaded = true; }
    requestAnimationFrame(size);
  }
  // Open the Message Center on a given tab (pods, sites, pins, inbox…).
  function tab(t) {
    const f = $('dmFrame'); if (!t) return;
    if (!loaded) { f.src = URL_ + '&tab=' + encodeURIComponent(t); loaded = true; return; }
    try { f.contentWindow.postMessage({ lwhmc: 'tab', tab: t }, location.origin); } catch (e) {}
  }
  function reload() { const f = $('dmFrame'); f.src = URL_ + '&r=' + Date.now(); loaded = true; }
  async function rpc(name, args) {
    const r = await fetch(API + name, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}), cache: 'no-store' });
    return r.ok ? r.json() : null;
  }
  // Red number on the Home tile: driver messages that still need attention.
  async function peek() {
    const t = token(); if (!t) { TMApp.setBadge('messages', 0); return; }
    try { const r = await rpc('msg_dispatch_inbox', { p_token: t, p_view: 'open', p_days: 7 }); TMApp.setBadge('messages', r && r.ok !== false ? (r.unread || 0) : 0); } catch (e) {}
  }
  async function signOut() {
    const t = token();
    try { localStorage.removeItem(TK); } catch (e) {}
    TMApp.setBadge('messages', 0);
    if (loaded) reload();
    if (t) { try { await rpc('drv_logout', { p_token: t }); } catch (e) {} }
  }
  window.addEventListener('resize', size);
  window.addEventListener('message', e => {
    if (e.origin !== location.origin || !e.data || e.data.lwhmc !== 'unread') return;
    TMApp.setBadge('messages', e.data.n || 0);
  });
  // Keep the Home badge fresh while the app is open.
  setInterval(() => { if (!document.hidden) peek(); }, 60000);

  return { open, tab, reload, peek, signOut, signedIn: () => !!token() };
})();
