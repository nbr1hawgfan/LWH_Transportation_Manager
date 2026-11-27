// Bump VERSION when you push changes so phones pick up new files.
const VERSION = 'tm-v2.12.1';
const SHELL = ['./', 'index.html', 'styles.css', 'manager.css', 'theme.css', 'icons/company-logo.png', 'config.js', 'manifest.json',
  'js/core.js', 'js/compat.js', 'js/mgr.js', 'js/reports.js', 'js/map.js',
  'js/yardboard.js', 'js/recruitboard.js', 'js/fuelboard.js', 'js/drivers.js', 'js/shopinv.js', 'js/dispatchplan.js', 'js/drivermsgs.js', 'js/gate.js', 'js/driverhours.js', 'js/attention.js', 'js/push.js', 'js/timeoff.js', 'js/fsc.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('tm-') && x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
// Network-first for the app's own files (fresh after updates), cache when offline.
// Server calls, map tiles, weather and fuel prices are never cached here.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-store' })
      .then(r => { const c = r.clone(); caches.open(VERSION).then(x => x.put(e.request, c)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});

/* ---------- notifications (lwh-push) ---------- */
self.addEventListener('push',e=>{
  let m={}; try{ m=e.data?e.data.json():{}; }catch(er){ m={title:'Logistics Warehouse',body:e.data&&e.data.text()}; }
  const url=new URL(m.path||'',self.registration.scope).href;
  e.waitUntil(self.registration.showNotification(m.title||'Logistics Warehouse',{
    body:m.body||'', tag:m.tag||undefined, renotify:!!m.tag, requireInteraction:!!m.urgent,
    icon:'icons/icon-192.png', badge:'icons/icon-192.png', data:{url}
  }));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const url=(e.notification.data&&e.notification.data.url)||self.registration.scope;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    const open=list.find(c=>c.url.startsWith(self.registration.scope)&&!c.url.includes('/dispatch/'));
    if(open){ open.postMessage({type:'openUrl',url}); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('pushsubscriptionchange',e=>{
  e.waitUntil(self.clients.matchAll({type:'window'}).then(list=>list.forEach(c=>c.postMessage({type:'resubscribe'}))));
});
