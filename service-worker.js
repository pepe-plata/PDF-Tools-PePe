const APP_CACHE='pdf-tools-pepe-app-v08';
const LIB_CACHE='pdf-tools-pepe-libs-v08';
const CDN=[
'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
'https://unpkg.com/pdfjs-dist@5.4.624/legacy/build/pdf.mjs',
'https://unpkg.com/pdfjs-dist@5.4.624/legacy/build/pdf.worker.mjs',
'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
];
const APP=['./','./index.html','./manifest.json','./service-worker.js','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(APP_CACHE).then(cache=>cache.addAll(APP)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>![APP_CACHE,LIB_CACHE].includes(k)).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=event.request.url;
  const isCdn=CDN.includes(url);
  const u=new URL(url);
  if(isCdn){
    event.respondWith(caches.open(LIB_CACHE).then(async cache=>{
      const hit=await cache.match(event.request);
      if(hit)return hit;
      try{const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response}catch(error){throw error}
    }));
    return;
  }
  if(u.origin===location.origin){
    event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{const copy=response.clone();caches.open(APP_CACHE).then(c=>c.put(event.request,copy));return response}).catch(()=>caches.match('./index.html'))));
  }
});
