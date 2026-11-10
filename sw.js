const shell = new URL('./index.html', self.registration.scope);
const entry = new URL(self.registration.scope);
const cacheName = 'squad-manager-shell:' + entry.pathname;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.add(new Request(shell, {cache:'reload'}));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const {request} = event;
  const url = new URL(request.url);
  if(request.method!=='GET'||request.mode!=='navigate'||url.origin!==entry.origin||
    (url.pathname!==entry.pathname&&url.pathname!==shell.pathname)) return;

  event.respondWith((async () => {
    try{
      const response = await fetch(request, {cache:'no-cache'});
      if(response.ok){
        try{ await (await caches.open(cacheName)).put(shell, response.clone()); }catch(_){}
      }
      return response;
    }catch(_){
      return (await caches.match(shell, {cacheName})) ||
        new Response('Squad Manager is offline. Connect to the internet and reopen it.', {status:503});
    }
  })());
});
