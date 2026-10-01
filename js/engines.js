/* ==========================================================================
   engines.js — Carga de librerías (pdf-lib, pdf.js, jszip)
   ========================================================================== */
export const CDN = {
  pdfLib: 'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  pdfjs:  'https://unpkg.com/pdfjs-dist@5.4.624/legacy/build/pdf.mjs',
  worker: 'https://unpkg.com/pdfjs-dist@5.4.624/legacy/build/pdf.worker.mjs',
  jszip:  'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
};

export const CACHE_NAME = 'pdf-tools-pepe-v025';

export async function openCache(){
  return 'caches' in window ? caches.open(CACHE_NAME) : null;
}

export async function ensureCached(url){
  const c = await openCache();
  if(c){ const hit = await c.match(url); if(hit) return 'cache'; }
  const r = await fetch(url,{cache:'no-store',mode:'cors'});
  if(!r.ok) throw new Error('No se pudo descargar '+url+' ('+r.status+')');
  if(c) await c.put(url, r.clone());
  return 'cdn';
}

export function loadScript(url){
  return new Promise((resolve,reject)=>{
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error('No se pudo cargar '+url));
    document.head.appendChild(s);
  });
}

export async function registerSW(){
  if(!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return false;
  try{
    const reg = await navigator.serviceWorker.register('./service-worker.js');
    await navigator.serviceWorker.ready;
    return !!reg;
  }catch(e){ return false; }
}

export async function ensureEngines(){
  await registerSW();
  const res = await Promise.allSettled([
    ensureCached(CDN.pdfLib),
    ensureCached(CDN.pdfjs),
    ensureCached(CDN.worker),
    ensureCached(CDN.jszip)
  ]);
  if(res[0].status !== 'fulfilled' && !window.PDFLib) throw new Error('No se pudo cargar pdf-lib');
  if(res[1].status !== 'fulfilled') throw new Error('No se pudo cargar pdf.js');
  if(!window.PDFLib) await loadScript(CDN.pdfLib);
  if(!window.JSZip) try{ await loadScript(CDN.jszip); }catch(e){}
  window.pdfjsLib = await import(CDN.pdfjs);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.worker;
  return true;
}