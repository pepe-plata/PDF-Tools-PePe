const CACHE='pdf-tools-pepe-v08';
const APP=['./','./index.html','./manifest.json','./service-worker.js','./icons/icon-192.png','./icons/icon-512.png'];
const CDN=[
'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
'https://unpkg.com/pdfjs-dist@5.4.624/legacy/build/pdf.mjs',
'https://unpkg.com/pdfjs-dist@5.4.624/legacy/build/pdf.worker.mjs',
'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
];
async function cacheUrl(cache,url){try{const r=await fetch(url,{cache:'no-store'});if(r.ok)await cache.put(url,r.clone());return r.ok}catch(e){return false}}
self.addEventListener('install',e=>e.waitUntil((async()=>{const c=await caches.open(CACHE);await Promise.allSettled(APP.map(u=>c.add(u)));await Promise.allSettled(CDN.map(u=>cacheUrl(c,u)));await self.skipWaiting()})()));
self.addEventListener('activate',e=>e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener('message',e=>{if(e.data?.type==='ENSURE_LIBS')e.waitUntil((async()=>{const c=await caches.open(CACHE);const result={};for(const u of CDN){result[u]=!!(await caches.match(u))||await cacheUrl(c,u)}e.source?.postMessage({type:'LIBS_READY',result})})())});
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET')return;
 const url=e.request.url;
 const isCdn=CDN.includes(url);
 const u=new URL(url);
 const isApp=u.origin===location.origin;
 if(!isCdn&&!isApp)return;
 e.respondWith((async()=>{
   const c=await caches.open(CACHE);
   const hit=await c.match(e.request);
   if(hit)return hit;
   try{
     const r=await fetch(e.request);
     if(r.ok)await c.put(e.request,r.clone());
     return r;
   }catch(err){
     if(isApp){const fallback=await c.match('./index.html');if(fallback)return fallback}
     throw err;
   }
 })());
});
