// ExpertOne service worker: lets the portal install as an app.
// Pages always come fresh from the network (so every update shows at once); a saved copy is used only when offline.
// Data calls (Supabase) are never cached.
const C = 'ex-shell-v1';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== C) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(r, {cache: 'no-cache'});
      if (res.ok && (r.mode === 'navigate' || /\.(html|png|svg|ico|webmanifest)$/.test(u.pathname) || u.pathname.endsWith('/'))) {
        const c = await caches.open(C); c.put(r, res.clone());
      }
      return res;
    } catch (err) {
      const hit = await caches.match(r);
      if (hit) return hit;
      if (r.mode === 'navigate') return new Response('<meta name="viewport" content="width=device-width"><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>No internet</h2><p>ExpertOne needs the internet. Connect and try again.</p><button onclick="location.reload()" style="font-size:16px;padding:10px 18px">Try again</button></body>', {headers: {'Content-Type': 'text/html'}});
      throw err;
    }
  })());
});
