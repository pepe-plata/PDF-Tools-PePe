/* ==========================================================================
   tools-annotate.js — Firmar, Llenar, Marca de agua, Extraer imágenes
   ========================================================================== */
import {
  CM, state, dom,
  msg, esc, base, parseRange, busy, dl,
  safeText, renderThumbOnPage, hexToRgb
} from './app.js';

/* ---------- Extraer imágenes ---------- */
function nativeSize(src){
  if(!src)return null;
  if(typeof ImageBitmap!=='undefined' && src instanceof ImageBitmap) return {w:src.width,h:src.height};
  if(src.naturalWidth||src.naturalHeight) return {w:src.naturalWidth,h:src.naturalHeight};
  if(src.videoWidth||src.videoHeight) return {w:src.videoWidth,h:src.videoHeight};
  if(src.width||src.height) return {w:src.width,h:src.height};
  return null;
}
async function extractImagesFromPage(page){
  const images=[]; const seen=new Set();
  const vp1 = page.getViewport({scale:1});
  const MAX_PIXELS = 4_000_000;
  const pixels = vp1.width*vp1.height;
  let renderScale = 1;
  if(pixels>MAX_PIXELS) renderScale = Math.sqrt(MAX_PIXELS/pixels);
  const vp = page.getViewport({scale:renderScale});
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1,Math.round(vp.width));
  canvas.height = Math.max(1,Math.round(vp.height));
  const ctx = canvas.getContext('2d',{willReadFrequently:true});
  const origDrawImage = ctx.drawImage.bind(ctx);
  const origPutImageData = ctx.putImageData.bind(ctx);
  const quickHash = (cv)=>{try{const c=document.createElement('canvas');c.width=8;c.height=8;const cx=c.getContext('2d',{willReadFrequently:true});cx.drawImage(cv,0,0,8,8);const d=cx.getImageData(0,0,8,8).data;let h=5381;for(let i=0;i<d.length;i++)h=(((h<<5)+h)^d[i])|0;return h>>>0}catch(e){return (Math.random()*1e9)|0}};
  const tryPush = (cv)=>{const w=cv.width|0,h=cv.height|0;if(w<8||h<8)return;if(w*h<64)return;const key=quickHash(cv)+'_'+w+'x'+h;if(seen.has(key))return;seen.add(key);images.push(cv)};
  const copyAtNativeSize = (src)=>{const nat=nativeSize(src);if(!nat||!nat.w||!nat.h)return null;try{const c=document.createElement('canvas');c.width=nat.w;c.height=nat.h;c.getContext('2d',{willReadFrequently:true}).drawImage(src,0,0,nat.w,nat.h);return c}catch(e){return null}};
  ctx.drawImage = function(...args){try{const c=copyAtNativeSize(args[0]);if(c)tryPush(c)}catch(e){}return origDrawImage(...args)};
  ctx.putImageData = function(id,x,y,...rest){try{if(id&&id.width&&id.height){const c=document.createElement('canvas');c.width=id.width;c.height=id.height;c.getContext('2d',{willReadFrequently:true}).putImageData(id,0,0);tryPush(c)}}catch(e){}return origPutImageData(id,x,y,...rest)};
  try{await page.render({canvasContext:ctx,viewport:vp}).promise}catch(e){}
  finally{ctx.drawImage=origDrawImage;ctx.putImageData=origPutImageData}
  return images;
}
export async function makeExtractImages(){
  if(!state.selected.size)throw new Error('Selecciona al menos una página.');
  const pages = [...state.selected].sort((a,b)=>a-b);
  const p = busy('Extrayendo…');
  try{
    const zip = new window.JSZip(); let totalImg = 0;
    for(let i=0;i<pages.length;i++){
      p.check();
      const n = pages[i];
      p.set((i/pages.length)*90, 'Página '+n+'…');
      let imgs = [];
      try{ const page = await state.pdfDoc.getPage(n); imgs = await extractImagesFromPage(page); }catch(e){}
      for(let j=0;j<imgs.length;j++){
        const blob = await new Promise(r=>imgs[j].toBlob(r,'image/png'));
        if(!blob)continue;
        zip.file('pagina-'+String(n).padStart(3,'0')+'_img-'+String(j+1).padStart(2,'0')+'.png', blob);
        totalImg++;
      }
    }
    if(!totalImg)throw new Error('No se encontraron imágenes incrustadas.');
    p.set(95,'Comprimiendo ZIP…');
    const blob = await zip.generateAsync({type:'blob'});
    await dl(await blob.arrayBuffer(), 'imagenes_extraidas.zip', 'application/zip');
    p.done('Extraídas '+totalImg+' imágenes.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ==========================================================================
   MARCA DE AGUA con manipulación gráfica
   ========================================================================== */
export function wireWatermarkTabs(){
  const tabs = dom.options.querySelectorAll('.wm-tabs button');
  tabs.forEach(btn=>{
    btn.onclick = () => {
      tabs.forEach(b=>b.classList.remove('on'));
      btn.classList.add('on');
      state._wmType = btn.dataset.wm;
      renderWatermarkBody();
    };
  });
  renderWatermarkBody();
}
function renderWatermarkBody(){
  const body = dom.options.querySelector('#wm-body');
  if(!body)return;
  if(state._wmType==='text'){
    body.innerHTML =
      '<label style="display:block;font-size:12px;color:var(--muted)">Texto<input id="wm-text" class="field" type="text" value="CONFIDENCIAL"></label>'+
      '<div class="row">'+
        '<label>Tamaño de letra (pt)<input id="wm-size" class="field" type="number" min="8" max="200" step="1" value="60"></label>'+
        '<label>Color<input id="wm-color" class="field" type="color" value="#666666" style="height:42px;padding:3px"></label>'+
      '</div>';
  }else if(state._wmType==='image'){
    body.innerHTML =
      '<label style="display:block;font-size:12px;color:var(--muted)">Imagen (PNG o JPG)<input id="wm-image" class="field" type="file" accept="image/png,image/jpeg"></label>';
    const inp = body.querySelector('#wm-image');
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if(!f)return;
      state._wmImageBytes = new Uint8Array(await f.arrayBuffer());
      // Resetear geometría al tamaño natural
      resetWatermarkGeometry();
      renderWatermarkPreview(true);
    };
  }else if(state._wmType==='pdf'){
    body.innerHTML =
      '<label style="display:block;font-size:12px;color:var(--muted)">PDF a superponer<input id="wm-pdf" class="field" type="file" accept="application/pdf"></label>'+
      '<label style="display:block;font-size:12px;color:var(--muted);margin-top:6px">Página del PDF<input id="wm-ppage" class="field" type="number" min="1" step="1" value="1"></label>';
    const inp = body.querySelector('#wm-pdf');
    inp.onchange = async () => {
      const f = inp.files && inp.files[0]; if(!f)return;
      state._wmPdfBytes = new Uint8Array(await f.arrayBuffer());
      resetWatermarkGeometry();
      renderWatermarkPreview(true);
    };
    const pg = body.querySelector('#wm-ppage');
    pg.oninput = () => { state._wmPdfPageNum = Math.max(1, parseInt(pg.value,10)||1); renderWatermarkPreview(true); };
  }

  const common = document.createElement('div');
  common.innerHTML =
    '<div class="row">'+
      '<label>Opacidad (0–1)<input id="wm-opacity" class="field" type="number" min="0.05" max="1" step="0.05" value="0.25"></label>'+
      '<label>Rotación (°)<input id="wm-rot" class="field" type="number" min="-180" max="180" step="1" value="0"></label>'+
    '</div>'+
    '<div class="row">'+
      '<label>Ancho (cm)<input id="wm-w" class="field" type="number" min="0.5" step="0.1" value="6"></label>'+
      '<label>Alto (cm)<input id="wm-h" class="field" type="number" min="0.5" step="0.1" value="6"></label>'+
    '</div>'+
    '<div class="row">'+
      '<label>Posición X (cm)<input id="wm-x" class="field" type="number" step="0.1" value="6"></label>'+
      '<label>Posición Y (cm)<input id="wm-y" class="field" type="number" step="0.1" value="6"></label>'+
    '</div>'+
    '<label style="display:block;font-size:12px;color:var(--muted);margin-top:6px">Páginas (vacío = todas)<input id="wm-pages" class="field" type="text" placeholder="Ej.: 1,3,5-8"></label>'+
    '<div class="section">Vista previa</div>'+
    '<p class="note" style="margin:4px 0 8px">Arrastra la marca para moverla, tira de una esquina para redimensionar y del handle superior para rotar.</p>'+
    '<div id="wmPreview" style="margin-top:4px"></div>'+
    '<div class="row" style="margin-top:8px">'+
      '<label>Página de la vista previa<input id="wm-preview-page" class="field" type="number" min="1" step="1" value="1"></label>'+
    '</div>'+
    '<div class="actions"><button class="primary" type="button" id="wm-apply">Aplicar marca de agua</button></div>';
  body.appendChild(common);
  body.querySelector('#wm-apply').onclick = () => applyWatermark().catch(e=>{ if(e.message!=='__CANCEL__')msg(e.message); });

  const pp = body.querySelector('#wm-preview-page');
  pp.oninput = () => renderWatermarkPreview(true);

  // Si el usuario edita los inputs numéricos, sincronizamos con el overlay
  ['wm-w','wm-h','wm-x','wm-y','wm-rot','wm-opacity'].forEach(id=>{
    const el = body.querySelector('#'+id);
    if(el) el.oninput = () => syncWatermarkFromInputs();
  });
  ['wm-text','wm-size','wm-color'].forEach(id=>{
    const el = body.querySelector('#'+id);
    if(el) el.oninput = () => renderWatermarkPreview();
  });

  resetWatermarkGeometry();
  renderWatermarkPreview();
}

/** Reinicia la geometría por defecto en cm. */
function resetWatermarkGeometry(){
  state._wmGeom = state._wmGeom || {};
  const g = state._wmGeom;
  g.w_cm = 6;
  g.h_cm = 6;
  g.x_cm = 6;
  g.y_cm = 6;
  g.rotation = 0;
}
/** Sincroniza los inputs con la geometría actual del overlay. */
function syncWatermarkFromInputs(){
  const g = state._wmGeom;
  if(!g) return;
  const v = (id) => parseFloat(dom.options.querySelector('#'+id)?.value) || 0;
  g.w_cm = Math.max(0.5, v('wm-w'));
  g.h_cm = Math.max(0.5, v('wm-h'));
  g.x_cm = v('wm-x');
  g.y_cm = v('wm-y');
  g.rotation = v('wm-rot');
  applyWatermarkGeomToDom();
}
/** Aplica la geometría al elemento DOM activo (si existe). */
function applyWatermarkGeomToDom(){
  const item = dom.options.querySelector('.wm-item');
  if(!item) return;
  const g = state._wmGeom;
  if(!g) return;
  const pxPerCm = state._wmScale * CM;
  item.style.left = (g.x_cm * pxPerCm) + 'px';
  item.style.top  = (g.y_cm * pxPerCm) + 'px';
  item.style.width  = (g.w_cm * pxPerCm) + 'px';
  item.style.height = (g.h_cm * pxPerCm) + 'px';
  item.style.transform = 'rotate(' + g.rotation + 'deg)';
}

export async function loadWatermarkPdf(f){
  if(!window.pdfjsLib) throw new Error('pdf.js no disponible');
  dom.preview.innerHTML = '<div class="status">Cargando PDF…</div>';
  try{
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    renderWatermarkPreview(true);
  }catch(e){ msg('No se pudo abrir: '+e.message); }
}
async function renderWatermarkPreview(force){
  const container = dom.options.querySelector('#wmPreview');
  if(!container||!state.pdfDoc)return;

  // Sincronizar inputs → geometría antes de pintar
  syncWatermarkFromInputs();

  const pageNum = parseInt((dom.options.querySelector('#wm-preview-page')||{}).value,10)||1;
  const safePage = Math.max(1,Math.min(state.pdfDoc.numPages,pageNum));
  if(!state._wmPageCanvas||state._wmPageNum!==safePage||force){
    const page = await state.pdfDoc.getPage(safePage);
    const vp1 = page.getViewport({scale:1});
    const maxW = Math.min(560, (window.innerWidth||360)-80);
    state._wmScale = maxW/vp1.width;
    const vp = page.getViewport({scale:state._wmScale});
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    state._wmPageCanvas = c; state._wmPageNum = safePage;
  }

  const overlay = document.createElement('div');
  overlay.style.position = 'relative';
  overlay.style.display = 'inline-block';
  overlay.style.lineHeight = '0';
  overlay.appendChild(state._wmPageCanvas);

  const g = state._wmGeom;
  const pxPerCm = state._wmScale * CM;
  const opacity = parseFloat((dom.options.querySelector('#wm-opacity')||{}).value) || 0.25;

  const item = document.createElement('div');
  item.className = 'wm-item';
  item.style.left = (g.x_cm * pxPerCm) + 'px';
  item.style.top  = (g.y_cm * pxPerCm) + 'px';
  item.style.width  = (g.w_cm * pxPerCm) + 'px';
  item.style.height = (g.h_cm * pxPerCm) + 'px';
  item.style.transform = 'rotate(' + g.rotation + 'deg)';
  item.style.opacity = String(opacity);

  // Contenido
  const content = document.createElement('div');
  content.className = 'wm-content';
  if(state._wmType === 'text'){
    const txt = (dom.options.querySelector('#wm-text')||{}).value||'CONFIDENCIAL';
    const size = parseFloat((dom.options.querySelector('#wm-size')||{}).value)||60;
    const color = (dom.options.querySelector('#wm-color')||{}).value||'#666666';
    content.textContent = txt;
    content.style.display = 'flex';
    content.style.alignItems = 'center';
    content.style.justifyContent = 'center';
    content.style.fontWeight = '700';
    content.style.whiteSpace = 'nowrap';
    content.style.color = color;
    // Tamaño de la fuente en relación al tamaño de la caja
    content.style.fontSize = (size * state._wmScale * 0.75) + 'px';
  }else{
    const img = document.createElement('img');
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.pointerEvents = 'none';
    if(state._wmType === 'image' && state._wmImageBytes){
      const blob = new Blob([state._wmImageBytes]);
      img.src = URL.createObjectURL(blob);
    }else if(state._wmType === 'pdf' && state._wmPdfBytes){
      try{
        const tdoc = await window.pdfjsLib.getDocument({data: state._wmPdfBytes.slice(0)}).promise;
        const tp = await tdoc.getPage(Math.max(1,Math.min(tdoc.numPages,state._wmPdfPageNum)));
        const tvp = tp.getViewport({scale:1});
        const tc = document.createElement('canvas'); tc.width = tvp.width; tc.height = tvp.height;
        await tp.render({canvasContext:tc.getContext('2d'),viewport:tvp}).promise;
        img.src = tc.toDataURL('image/png');
      }catch(e){}
    }
    content.appendChild(img);
  }
  item.appendChild(content);

  // Handles
  ['nw','ne','sw','se','rot'].forEach(kind=>{
    const h = document.createElement('div');
    h.className = 'wm-handle h-' + kind;
    h.dataset.kind = kind;
    item.appendChild(h);
  });

  overlay.appendChild(item);
  container.innerHTML = '';
  container.appendChild(overlay);

  // Interacción: mover
  item.addEventListener('pointerdown', (e) => {
    if(e.target.classList.contains('wm-handle')) return;
    item.classList.add('active');
    e.preventDefault();
    try{ item.setPointerCapture(e.pointerId); }catch(_){}
    const r = item.getBoundingClientRect();
    const offX = e.clientX - r.left, offY = e.clientY - r.top;
    const start = {...g};
    const onMove = (ev) => {
      const wrapRect = overlay.getBoundingClientRect();
      const wpx = parseFloat(item.style.width)||0;
      const hpx = parseFloat(item.style.height)||0;
      let nl = ev.clientX - wrapRect.left - offX;
      let nt = ev.clientY - wrapRect.top - offY;
      nl = Math.max(-wpx*0.5, Math.min(wrapRect.width - wpx*0.5, nl));
      nt = Math.max(-hpx*0.5, Math.min(wrapRect.height - hpx*0.5, nt));
      item.style.left = nl + 'px';
      item.style.top  = nt + 'px';
      const cm = state._wmScale * CM;
      g.x_cm = nl / cm;
      g.y_cm = nt / cm;
      const xI = dom.options.querySelector('#wm-x');
      const yI = dom.options.querySelector('#wm-y');
      if(xI) xI.value = g.x_cm.toFixed(2);
      if(yI) yI.value = g.y_cm.toFixed(2);
    };
    const onUp = () => {
      item.removeEventListener('pointermove', onMove);
      item.removeEventListener('pointerup', onUp);
      item.removeEventListener('pointercancel', onUp);
    };
    item.addEventListener('pointermove', onMove);
    item.addEventListener('pointerup', onUp);
    item.addEventListener('pointercancel', onUp);
  });

  // Handles: redimensionar y rotar
  item.querySelectorAll('.wm-handle').forEach(h => {
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      item.classList.add('active');
      try{ h.setPointerCapture(e.pointerId); }catch(_){}
      const kind = h.dataset.kind;
      const startRect = item.getBoundingClientRect();
      const wrapRect  = overlay.getBoundingClientRect();
      const startW = startRect.width, startH = startRect.height;
      const startL = startRect.left - wrapRect.left, startT = startRect.top - wrapRect.top;
      const cx = startL + startW/2, cy = startT + startH/2;
      const ratio = startH / startW || 1;
      const cm = state._wmScale * CM;
      const onMove = (ev) => {
        if(kind === 'rot'){
          const dx = ev.clientX - wrapRect.left - cx;
          const dy = ev.clientY - wrapRect.top  - cy;
          let deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
          if(deg > 180) deg -= 360;
          if(deg < -180) deg += 360;
          g.rotation = Math.round(deg);
          item.style.transform = 'rotate(' + g.rotation + 'deg)';
          const rotI = dom.options.querySelector('#wm-rot');
          if(rotI) rotI.value = g.rotation;
          return;
        }
        // Redimensión por distancia horizontal desde el centro
        const mx = ev.clientX - wrapRect.left;
        const dist = Math.abs(mx - cx);
        let newW = Math.max(30, dist*2);
        let newH = newW * ratio;
        newW = Math.min(newW, wrapRect.width * 1.5);
        newH = Math.min(newH, wrapRect.height * 1.5);
        item.style.width  = newW + 'px';
        item.style.height = newH + 'px';
        let newL = cx - newW/2;
        let newT = cy - newH/2;
        item.style.left = newL + 'px';
        item.style.top  = newT + 'px';
        g.w_cm = newW / cm;
        g.h_cm = newH / cm;
        g.x_cm = newL / cm;
        g.y_cm = newT / cm;
        const wI = dom.options.querySelector('#wm-w');
        const hI = dom.options.querySelector('#wm-h');
        const xI = dom.options.querySelector('#wm-x');
        const yI = dom.options.querySelector('#wm-y');
        if(wI) wI.value = g.w_cm.toFixed(2);
        if(hI) hI.value = g.h_cm.toFixed(2);
        if(xI) xI.value = g.x_cm.toFixed(2);
        if(yI) yI.value = g.y_cm.toFixed(2);
      };
      const onUp = () => {
        h.removeEventListener('pointermove', onMove);
        h.removeEventListener('pointerup', onUp);
        h.removeEventListener('pointercancel', onUp);
      };
      h.addEventListener('pointermove', onMove);
      h.addEventListener('pointerup', onUp);
      h.addEventListener('pointercancel', onUp);
    });
  });

  // Deseleccionar si se hace clic fuera
  overlay.addEventListener('pointerdown', (e) => {
    if(!item.contains(e.target)) item.classList.remove('active');
  });
}

export async function applyWatermark(){
  const pagesInput = dom.options.querySelector('#wm-pages');
  const opacity = parseFloat(dom.options.querySelector('#wm-opacity').value) || 0.25;
  const pages = pagesInput && pagesInput.value.trim()
    ? parseRange(pagesInput.value, state.pdfDoc.numPages)
    : Array.from({length:state.pdfDoc.numPages},(_,i)=>i+1);
  if(!pages.length) throw new Error('No hay páginas donde aplicar.');

  const g = state._wmGeom;
  const rotation = g.rotation;
  const wPt = g.w_cm * CM;
  const hPt = g.h_cm * CM;
  const xPt = g.x_cm * CM;
  const yPt = g.y_cm * CM;

  const p = busy('Aplicando marca…');
  try{
    const src = await window.PDFLib.PDFDocument.load(await state.loadedFiles[0].arrayBuffer(),{ignoreEncryption:true});
    let textFont=null,textColor=null,textSize=null,textStr=null;
    let imageEmb=null;

    if(state._wmType==='text'){
      textStr = dom.options.querySelector('#wm-text').value||'CONFIDENCIAL';
      textSize = parseFloat(dom.options.querySelector('#wm-size').value)||60;
      textColor = hexToRgb(dom.options.querySelector('#wm-color').value||'#666666');
      textFont = await src.embedFont(window.PDFLib.StandardFonts.HelveticaBold);
    }else if(state._wmType==='image'){
      if(!state._wmImageBytes)throw new Error('Selecciona imagen.');
      try{ imageEmb = await src.embedPng(state._wmImageBytes); }catch(_){ imageEmb = await src.embedJpg(state._wmImageBytes); }
    }else if(state._wmType==='pdf'){
      if(!state._wmPdfBytes)throw new Error('Selecciona PDF.');
      const stampSrc = await window.PDFLib.PDFDocument.load(state._wmPdfBytes,{ignoreEncryption:true});
      const total = stampSrc.getPageCount();
      const idx = Math.max(0, Math.min(total-1, state._wmPdfPageNum-1));
      const [embedded] = await src.embedPdf(state._wmPdfBytes, [idx]);
      imageEmb = embedded;
    }

    for(let i=0;i<pages.length;i++){
      p.check();
      const n = pages[i];
      const page = src.getPage(n-1);
      const {height:pgH} = page.getSize();
      // y en el PDF va desde abajo, nuestra geometría está desde arriba
      const yPdf = pgH - yPt - hPt;

      if(state._wmType==='text'){
        // Escalar el tamaño de fuente al alto de la caja
        const scale = Math.min(hPt / textSize, 1);
        const drawSize = textSize * Math.max(0.5, scale);
        const textW = textFont.widthOfTextAtSize(safeText(textStr), drawSize);
        const xText = xPt + Math.max(0, (wPt - textW) / 2);
        const yText = yPdf + Math.max(0, (hPt - drawSize) / 2);
        page.drawText(safeText(textStr),{
          x: xText, y: yText,
          size: drawSize, font: textFont, color: textColor,
          opacity: Math.max(0,Math.min(1,opacity)),
          rotate: window.PDFLib.degrees(rotation)
        });
      }else{
        page.drawImage(imageEmb,{
          x: xPt, y: yPdf, width: wPt, height: hPt,
          opacity: Math.max(0,Math.min(1,opacity)),
          rotate: window.PDFLib.degrees(rotation)
        });
      }
      p.set(30+(i+1)/pages.length*60,'Página '+n+'…');
    }
    p.set(95,'Guardando…');
    await dl(await src.save(), base(state.loadedFiles[0].name)+'_marca_agua.pdf');
    p.done('Marca de agua aplicada.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ==========================================================================
   LLENAR PDF
   ========================================================================== */
export async function loadFillPdf(f){
  if(!window.pdfjsLib) throw new Error('pdf.js no disponible');
  dom.preview.innerHTML = '<div class="status">Cargando PDF…</div>';
  try{
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    state._fillItems = []; state._fillSelectedIdx = -1; state._fillPageNum = 1;
    renderFillPreview(true);
  }catch(e){ msg('No se pudo abrir: '+e.message); }
}
async function renderFillPreview(force){
  if(!state._fillPageCanvas || force){
    if(!dom.preview.querySelector('#fillPreviewHost')){
      dom.preview.innerHTML =
        '<div class="section">Vista previa ('+state.pdfDoc.numPages+' páginas)</div>'+
        '<div class="row">'+
          '<label>Página<input id="fill-page" class="field" type="number" min="1" max="'+state.pdfDoc.numPages+'" value="'+state._fillPageNum+'"></label>'+
          '<div style="display:flex;align-items:flex-end"><button class="secondary" type="button" id="fill-del" style="width:100%">Eliminar texto seleccionado</button></div>'+
        '</div>'+
        '<div id="fillPreviewHost" style="margin-top:10px"></div>'+
        '<div class="actions"><button class="primary" type="button" id="fill-apply">Insertar todos los textos</button></div>';
      dom.preview.querySelector('#fill-page').onchange = (e) => {
        state._fillPageNum = Math.max(1, Math.min(state.pdfDoc.numPages, parseInt(e.target.value,10)||1));
        renderFillPreview(true);
      };
      dom.preview.querySelector('#fill-del').onclick = () => {
        if(state._fillSelectedIdx>=0){ state._fillItems.splice(state._fillSelectedIdx,1); state._fillSelectedIdx = -1; renderFillPreview(true); }
      };
      dom.preview.querySelector('#fill-apply').onclick = () => applyFill().catch(e=>{ if(e.message!=='__CANCEL__')msg(e.message); });
    }
    const page = await state.pdfDoc.getPage(state._fillPageNum);
    const vp1 = page.getViewport({scale:1});
    const maxW = Math.min(560, (window.innerWidth||360)-80);
    state._fillScale = maxW/vp1.width;
    const vp = page.getViewport({scale:state._fillScale});
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    state._fillPageCanvas = c;
  }
  const host = dom.preview.querySelector('#fillPreviewHost');
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'sig-wrap';
  wrap.style.position = 'relative';
  wrap.appendChild(state._fillPageCanvas);
  host.appendChild(wrap);

  state._fillItems.forEach((item,idx)=>{
    if(item.page!==state._fillPageNum)return;
    const el = document.createElement('div');
    el.className = 'fill-item'+(idx===state._fillSelectedIdx?' selected':'');
    el.style.left = (item.x_cm*state._fillScale*CM)+'px';
    el.style.top = (item.y_cm*state._fillScale*CM)+'px';
    if(item.bg && item.bg !== 'transparent') el.style.background = item.bg;
    else el.style.background = 'rgba(37,99,235,.08)';
    el.innerHTML =
      '<span class="fill-text" style="font-size:'+(item.size*state._fillScale)+'px;font-weight:'+(item.bold?'700':'400')+';font-style:'+(item.italic?'italic':'normal')+';text-decoration:'+(item.underline?'underline':'none')+';color:'+item.color+';font-family:'+fontFamilyCSS(item.font)+'">'+esc(item.text||'(texto)')+'</span>'+
      '<span class="fill-handle"></span>';
    wrap.appendChild(el);
    el.addEventListener('pointerdown',(e)=>{
      state._fillSelectedIdx = idx;
      const setVal = (id, v) => { const el2 = dom.options.querySelector(id); if(el2) el2.value = v; };
      setVal('#fl-text', item.text);
      setVal('#fl-size', item.size);
      setVal('#fl-font', item.font);
      setVal('#fl-color', item.color);
      setVal('#fl-underline', item.underline ? '1' : '0');
      setVal('#fl-style', item.style || '');
      const bgOn = dom.options.querySelector('#fl-bg-on');
      const bgCol = dom.options.querySelector('#fl-bg');
      if(bgOn) bgOn.checked = item.bg && item.bg !== 'transparent';
      if(bgCol && item.bg && item.bg !== 'transparent') bgCol.value = item.bg;
      const upd = dom.options.querySelector('#fl-update');
      if(upd) upd.style.display = '';

      const kind = e.target.classList.contains('fill-handle') ? 'resize' : 'move';
      const startX = e.clientX, startY = e.clientY;
      const startXCm = item.x_cm, startYCm = item.y_cm, startSize = item.size;
      try { el.setPointerCapture(e.pointerId); } catch(_) {}
      const onMove = (ev) => {
        const dx = (ev.clientX - startX) / (state._fillScale * CM);
        const dy = (ev.clientY - startY) / (state._fillScale * CM);
        if(kind === 'move'){
          item.x_cm = Math.max(0, startXCm + dx);
          item.y_cm = Math.max(0, startYCm + dy);
        } else {
          item.size = Math.max(6, startSize + dx * 4);
        }
        el.style.left = (item.x_cm * state._fillScale * CM) + 'px';
        el.style.top = (item.y_cm * state._fillScale * CM) + 'px';
        el.querySelector('.fill-text').style.fontSize = (item.size * state._fillScale) + 'px';
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
      e.preventDefault();
    });
  });
}
function fontFamilyCSS(f){
  if(f && f.startsWith('Times')) return 'Times, serif';
  if(f && f.startsWith('Courier')) return 'Courier New, monospace';
  if(f === 'Symbol') return 'serif';
  if(f === 'ZapfDingbats') return 'serif';
  return 'Helvetica, Arial, sans-serif';
}
export function addFillItem(page){
  const text = (dom.options.querySelector('#fl-text')||{}).value || 'Texto nuevo';
  const bgOn = (dom.options.querySelector('#fl-bg-on')||{}).checked;
  const bgColor = (dom.options.querySelector('#fl-bg')||{}).value || '#ffff00';
  state._fillItems.push({
    x_cm: 2, y_cm: 2,
    text,
    size: parseFloat((dom.options.querySelector('#fl-size')||{}).value) || 14,
    font: (dom.options.querySelector('#fl-font')||{}).value || 'Helvetica',
    color: (dom.options.querySelector('#fl-color')||{}).value || '#000000',
    bg: bgOn ? bgColor : 'transparent',
    style: (dom.options.querySelector('#fl-style')||{}).value || '',
    bold: ((dom.options.querySelector('#fl-style')||{}).value || '').includes('bold'),
    italic: ((dom.options.querySelector('#fl-style')||{}).value || '').includes('italic'),
    underline: (dom.options.querySelector('#fl-underline')||{}).value === '1',
    page: state._fillPageNum
  });
  state._fillSelectedIdx = state._fillItems.length - 1;
  renderFillPreview();
}
export function updateSelectedFillItem(){
  if(state._fillSelectedIdx < 0 || !state._fillItems[state._fillSelectedIdx]) {
    msg('Selecciona primero un texto.');
    return;
  }
  const item = state._fillItems[state._fillSelectedIdx];
  item.text = (dom.options.querySelector('#fl-text')||{}).value || item.text;
  item.size = parseFloat((dom.options.querySelector('#fl-size')||{}).value) || item.size;
  item.font = (dom.options.querySelector('#fl-font')||{}).value || item.font;
  item.color = (dom.options.querySelector('#fl-color')||{}).value || item.color;
  const bgOn = (dom.options.querySelector('#fl-bg-on')||{}).checked;
  const bgColor = (dom.options.querySelector('#fl-bg')||{}).value || '#ffff00';
  item.bg = bgOn ? bgColor : 'transparent';
  const st = (dom.options.querySelector('#fl-style')||{}).value || '';
  item.style = st; item.bold = st.includes('bold'); item.italic = st.includes('italic');
  item.underline = (dom.options.querySelector('#fl-underline')||{}).value === '1';
  renderFillPreview();
}
export async function applyFill(){
  if(!state._fillItems.length)throw new Error('Añade al menos un texto.');
  const p = busy('Insertando textos…');
  try{
    const pdf = await window.PDFLib.PDFDocument.load(await state.loadedFiles[0].arrayBuffer(),{ignoreEncryption:true});
    const fontsCache = {};
    async function getFont(name, bold, italic){
      const key = name + (bold ? 'B' : '') + (italic ? 'I' : '');
      if(fontsCache[key]) return fontsCache[key];
      const SF = window.PDFLib.StandardFonts;
      let std;
      if(name === 'Symbol') std = SF.Symbol;
      else if(name === 'ZapfDingbats') std = SF.ZapfDingbats;
      else if(name === 'TimesRomanBold') std = SF.TimesRomanBold;
      else if(name === 'TimesRomanItalic') std = SF.TimesRomanItalic;
      else if(name === 'CourierBold') std = SF.CourierBold;
      else if(name === 'CourierOblique') std = SF.CourierOblique;
      else if(name === 'HelveticaBold') std = SF.HelveticaBold;
      else if(name === 'HelveticaOblique') std = SF.HelveticaOblique;
      else if(name === 'TimesRoman') std = italic ? SF.TimesRomanItalic : (bold ? SF.TimesRomanBold : SF.TimesRoman);
      else if(name === 'Courier') std = italic ? SF.CourierOblique : (bold ? SF.CourierBold : SF.Courier);
      else std = italic ? SF.HelveticaOblique : (bold ? SF.HelveticaBold : SF.Helvetica);
      const f = await pdf.embedFont(std);
      fontsCache[key] = f;
      return f;
    }
    for(const item of state._fillItems){
      p.check();
      const page = pdf.getPage(item.page-1);
      const {height:pgH} = page.getSize();
      const font = await getFont(item.font, item.bold, item.italic);
      const x = item.x_cm * CM;
      const y = pgH - (item.y_cm * CM) - item.size * 0.9;
      const rgb = hexToRgb(item.color);

      if(item.bg && item.bg !== 'transparent'){
        const textW = font.widthOfTextAtSize(safeText(item.text), item.size);
        const padX = 2, padY = item.size * 0.15;
        page.drawRectangle({
          x: x - padX,
          y: y - padY,
          width: textW + padX*2,
          height: item.size + padY*2,
          color: hexToRgb(item.bg)
        });
      }

      page.drawText(safeText(item.text),{x,y,size:item.size,font,color:rgb});
      if(item.underline){
        const w = font.widthOfTextAtSize(safeText(item.text), item.size);
        page.drawLine({start:{x,y:y-2},end:{x:x+w,y:y-2},thickness:0.7,color:rgb});
      }
      p.set(30+(state._fillItems.indexOf(item)/state._fillItems.length)*60, 'Texto '+(state._fillItems.indexOf(item)+1)+'/'+state._fillItems.length);
    }
    p.set(95,'Guardando…');
    await dl(await pdf.save(), base(state.loadedFiles[0].name)+'_lleno.pdf');
    p.done('Textos insertados correctamente.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ==========================================================================
   FIRMAR PDF
   ========================================================================== */
const SIG_STORE_KEY = 'pdf-tools-pepe-signatures';
export function getSavedSignatures(){
  try{ return JSON.parse(localStorage.getItem(SIG_STORE_KEY)||'[]'); }catch(e){ return[]; }
}
function setSavedSignatures(arr){ try{ localStorage.setItem(SIG_STORE_KEY, JSON.stringify(arr)); }catch(e){} }

export async function loadSignaturePdf(f){
  if(!window.PDFLib||!window.pdfjsLib) throw new Error('Motores no disponibles');
  dom.preview.innerHTML = '<div class="status">Cargando PDF…</div>';
  try{
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    state._sigPageCanvas = null; state._sigPageNum = null; state._sigScale = 1; state._sigAngle = 0;
    renderSignatureConfig();
  }catch(e){ msg('No se pudo abrir: '+e.message); }
}
function renderSignatureConfig(){
  const rest = document.createElement('div');
  rest.id = 'sigConfig';
  rest.innerHTML =
    '<div class="section">2. Página y posición</div>'+
    '<label style="display:block;font-size:12px;color:var(--muted);margin-top:6px">Páginas (marca una o varias)'+
      '<div id="sigPages" style="margin-top:6px;display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:6px;max-height:150px;overflow:auto;padding:6px;border:1px solid var(--border);border-radius:10px;background:var(--surface)"></div>'+
    '</label>'+
    '<div class="row">'+
      '<label>Tamaño firma (cm)<div style="display:flex;gap:6px"><input id="sigW" class="field" type="number" min="0.5" step="0.1" value="5"><input id="sigH" class="field" type="number" min="0.5" step="0.1" value="2.5"></div></label>'+
      '<label>Rotación (°)<input id="sigAngleInput" class="field" type="number" min="-180" max="180" step="1" value="0"></label>'+
    '</div>'+
    '<div class="row">'+
      '<label>Posición X (cm desde izquierda)<input id="sigX" class="field" type="number" min="0" step="0.1" value="10"></label>'+
      '<label>Posición Y (cm desde abajo)<input id="sigY" class="field" type="number" min="0" step="0.1" value="3"></label>'+
    '</div>'+
    '<div class="section">3. Vista previa</div>'+
    '<p class="note" style="margin:4px 0 8px">Toca la firma para activarla. Arrastra dentro para moverla, tira de una esquina para redimensionar y del handle superior para rotar.</p>'+
    '<div id="sigPreview" style="margin-top:4px"></div>'+
    '<div class="actions"><button class="primary" type="button" id="sigInsert">Insertar y guardar</button></div>';
  dom.options.appendChild(rest);

  const pagesBox = dom.options.querySelector('#sigPages');
  for(let i=1;i<=state.pdfDoc.numPages;i++){
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--border);border-radius:8px;background:var(--surface2);cursor:pointer;font-size:12px';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = i; cb.id = 'sigchk_'+i;
    if(i===1)cb.checked = true;
    lbl.htmlFor = cb.id;
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode('Pág '+i));
    pagesBox.appendChild(lbl);
    cb.addEventListener('change',()=>{
      const first = pagesBox.querySelector('input[type=checkbox]:checked');
      if(first){ const n = parseInt(first.value,10); if(state._sigPageNum!==n) renderSignaturePreview(true,n); }
    });
  }
  ['sigW','sigH','sigX','sigY'].forEach(id=>{
    const el = dom.options.querySelector('#'+id);
    if(el) el.oninput = () => updateSignaturePosition();
  });
  const angEl = dom.options.querySelector('#sigAngleInput');
  if(angEl) angEl.oninput = () => { state._sigAngle = parseFloat(angEl.value)||0; updateSignaturePosition(); };
  dom.options.querySelector('#sigInsert').onclick = () => insertSignature().catch(e=>{ if(e.message!=='__CANCEL__')msg(e.message); });
  setupSignaturePad();
  renderSignaturePreview(true,1);
  renderSavedSignatures();
}
function renderSavedSignatures(){
  const saved = getSavedSignatures();
  const host = dom.options.querySelector('#savedSigs');
  if(!host)return;
  host.innerHTML = '';
  saved.forEach((item,idx)=>{
    const d = document.createElement('div'); d.className = 'saved-sig';
    d.innerHTML = '<img src="'+item.dataURL+'" alt=""><button type="button" class="del" title="Eliminar">✕</button>';
    d.querySelector('img').onclick = () => loadSignatureIntoPad(item.dataURL);
    d.querySelector('.del').onclick = (e) => {
      e.stopPropagation();
      const arr = getSavedSignatures(); arr.splice(idx,1); setSavedSignatures(arr); renderSavedSignatures();
    };
    host.appendChild(d);
  });
}
function loadSignatureIntoPad(dataURL){
  const img = new Image();
  img.onload = () => {
    const canvas = dom.options.querySelector('#sigCanvas');
    if(!canvas||!state.sigCtx)return;
    const dpr = window.devicePixelRatio||1;
    const cw = canvas.width/dpr, ch = canvas.height/dpr;
    state.sigCtx.clearRect(0,0,cw,ch);
    const k = Math.min(cw/img.width, ch/img.height);
    const w = img.width*k, h = img.height*k;
    const x = (cw-w)/2, y = (ch-h)/2;
    state.sigCtx.drawImage(img,x,y,w,h);
    state.sigHasStrokes = true;
    updateSignatureImage();
    updateSignaturePosition();
  };
  img.src = dataURL;
}
function setupSignaturePad(){
  const canvas = dom.options.querySelector('#sigCanvas');
  if(!canvas)return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio||1;
  canvas.width = Math.max(1, Math.round(rect.width*dpr));
  canvas.height = Math.max(1, Math.round(rect.height*dpr));
  state.sigCtx = canvas.getContext('2d');
  state.sigCtx.setTransform(dpr,0,0,dpr,0,0);
  state.sigCtx.lineCap = 'round';
  state.sigCtx.lineJoin = 'round';
  state.sigCtx.strokeStyle = state._sigStroke;
  state.sigCtx.lineWidth = state._sigStrokeWidth;
  state.sigHasStrokes = false;

  const getPos = (e) => {
    const r = canvas.getBoundingClientRect();
    return {x: e.clientX - r.left, y: e.clientY - r.top};
  };

  let shapeStart = null, lastSnapshot = null;

  const start = (e) => {
    e.preventDefault();
    try{ canvas.setPointerCapture(e.pointerId); }catch(_){}
    const {x,y} = getPos(e);
    if(state._sigTool === 'pencil'){
      state.sigDrawing = true;
      state.sigCtx.beginPath();
      state.sigCtx.moveTo(x,y);
    }else{
      lastSnapshot = state.sigCtx.getImageData(0,0,canvas.width,canvas.height);
      shapeStart = {x,y};
    }
  };

  const move = (e) => {
    if(state._sigTool === 'pencil'){
      if(!state.sigDrawing) return;
      e.preventDefault();
      const {x,y} = getPos(e);
      state.sigCtx.lineTo(x,y);
      state.sigCtx.stroke();
      state.sigHasStrokes = true;
      return;
    }
    if(!shapeStart) return;
    e.preventDefault();
    const {x,y} = getPos(e);
    state.sigCtx.putImageData(lastSnapshot,0,0);
    drawShape(shapeStart.x, shapeStart.y, x, y);
    state.sigHasStrokes = true;
  };

  const end = () => {
    if(state._sigTool === 'pencil'){
      if(state.sigDrawing){
        state.sigDrawing = false;
        if(state.sigHasStrokes){ updateSignatureImage(); updateSignaturePosition(); }
      }
      return;
    }
    shapeStart = null;
    if(state.sigHasStrokes){ updateSignatureImage(); updateSignaturePosition(); }
  };

  function drawShape(x0,y0,x1,y1){
    const ctx = state.sigCtx;
    const stroke = state._sigStroke;
    const fill = state._sigFill;
    ctx.save();
    ctx.lineWidth = state._sigStrokeWidth || 2.4;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill === 'transparent' ? 'rgba(0,0,0,0)' : fill;
    ctx.beginPath();
    const x = Math.min(x0,x1), y = Math.min(y0,y1);
    const w = Math.abs(x1-x0), h = Math.abs(y1-y0);
    if(state._sigTool === 'rect'){
      ctx.rect(x,y,w,h);
    }else if(state._sigTool === 'circle'){
      const rx = w/2, ry = h/2;
      ctx.ellipse(x+rx, y+ry, rx, ry, 0, 0, Math.PI*2);
    }
    if(fill !== 'transparent') ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);

  const clearBtn = dom.options.querySelector('#sigClear');
  if(clearBtn) clearBtn.onclick = () => {
    state.sigCtx.save(); state.sigCtx.setTransform(1,0,0,1,0,0);
    state.sigCtx.clearRect(0,0,canvas.width,canvas.height);
    state.sigCtx.restore();
    state.sigHasStrokes = false;
    updateSignatureImage();
  };
  const saveBtn = dom.options.querySelector('#sigSave');
  if(saveBtn) saveBtn.onclick = () => {
    const url = getSignatureDataURL();
    if(!url){ msg('Dibuja una firma antes de guardarla.'); return; }
    const arr = getSavedSignatures();
    arr.push({dataURL:url, ts:Date.now()});
    while(arr.length > 20) arr.shift();
    setSavedSignatures(arr);
    renderSavedSignatures();
  };

  const toolbar = dom.options.querySelector('#sigDrawTools');
  if(toolbar){
    const setTool = (tool) => {
      state._sigTool = tool;
      toolbar.querySelectorAll('button[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
    };
    toolbar.querySelectorAll('button[data-tool]').forEach(btn => { btn.onclick = () => setTool(btn.dataset.tool); });
    setTool(state._sigTool);

    const colorPencil = dom.options.querySelector('#sigStrokeColor');
    const colorFill   = dom.options.querySelector('#sigFillColor');
    const fillOn      = dom.options.querySelector('#sigFillOn');
    const strokeW     = dom.options.querySelector('#sigStrokeWidth');
    if(colorPencil){
      colorPencil.value = state._sigStroke;
      colorPencil.oninput = () => { state._sigStroke = colorPencil.value; state._sigColor = colorPencil.value; };
    }
    if(colorFill && fillOn){
      const sync = () => { state._sigFill = fillOn.checked ? colorFill.value : 'transparent'; };
      colorFill.oninput = sync; fillOn.onchange = sync; sync();
    }
    if(strokeW){
      state._sigStrokeWidth = parseFloat(strokeW.value) || 2.4;
      strokeW.oninput = () => { state._sigStrokeWidth = parseFloat(strokeW.value) || 2.4; };
    }
  }
}
function getSignatureDataURL(){
  const canvas = dom.options.querySelector('#sigCanvas');
  if(!canvas||!state.sigHasStrokes)return null;
  const w = canvas.width, h = canvas.height;
  if(!w||!h)return null;
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0,0,w,h).data;
  let minX=w,minY=h,maxX=-1,maxY=-1;
  for(let y=0;y<h;y++){
    const row = y*w;
    for(let x=0;x<w;x++){
      const idx = (row+x)*4;
      if(data[idx+3]>0){ if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; }
    }
  }
  if(maxX<0)return null;
  const dpr = window.devicePixelRatio||1;
  const pad = Math.round(6*dpr);
  minX=Math.max(0,minX-pad); minY=Math.max(0,minY-pad);
  maxX=Math.min(w-1,maxX+pad); maxY=Math.min(h-1,maxY+pad);
  const cw = maxX-minX+1, ch = maxY-minY+1;
  const out = document.createElement('canvas');
  out.width=cw; out.height=ch;
  out.getContext('2d').drawImage(canvas,minX,minY,cw,ch,0,0,cw,ch);
  return out.toDataURL('image/png');
}
function updateSignatureImage(){
  const item = dom.options.querySelector('.sig-item');
  const img = dom.options.querySelector('#sigImg');
  if(!item||!img)return;
  const url = getSignatureDataURL();
  if(url){
    img.src = url; img.style.display='block'; item.style.display='block';
    const probe = new Image();
    probe.onload = () => {
      const wCm = parseFloat(dom.options.querySelector('#sigW').value)||5;
      const hCm = wCm*(probe.height/probe.width);
      const hInput = dom.options.querySelector('#sigH');
      if(hInput&&!hInput.dataset.touched)hInput.value = hCm.toFixed(2);
      updateSignaturePosition();
    };
    probe.src = url;
  }else{ img.style.display='none'; item.style.display='none'; }
}
function updateSignaturePosition(){
  const item = dom.options.querySelector('.sig-item');
  if(!item||item.style.display==='none')return;
  if(!state._sigPageCanvas)return;
  const wCm = parseFloat(dom.options.querySelector('#sigW').value)||5;
  const hCm = parseFloat(dom.options.querySelector('#sigH').value)||2.5;
  const xCm = parseFloat(dom.options.querySelector('#sigX').value)||0;
  const yCm = parseFloat(dom.options.querySelector('#sigY').value)||0;
  const pxPerCm = state._sigScale*CM;
  const wpx = wCm*pxPerCm, hpx = hCm*pxPerCm;
  const leftPx = xCm*pxPerCm;
  const topPx = state._sigPageCanvas.height-yCm*pxPerCm-hpx;
  item.style.left = leftPx+'px';
  item.style.top = topPx+'px';
  item.style.width = wpx+'px';
  item.style.height = hpx+'px';
  item.style.transform = 'rotate('+state._sigAngle+'deg)';
  const angEl = dom.options.querySelector('#sigAngleInput');
  if(angEl&&document.activeElement!==angEl)angEl.value = state._sigAngle;
}
async function renderSignaturePreview(force,pageOverride){
  const container = dom.options.querySelector('#sigPreview');
  if(!container)return;
  let pageNum = pageOverride;
  if(!pageNum){
    const firstChecked = dom.options.querySelector('#sigPages input[type=checkbox]:checked');
    pageNum = firstChecked ? parseInt(firstChecked.value,10) : 1;
  }
  if(!state._sigPageCanvas||state._sigPageNum!==pageNum||force){
    const page = await state.pdfDoc.getPage(pageNum);
    const vp1 = page.getViewport({scale:1});
    const maxW = Math.min(560, (window.innerWidth||360)-80);
    state._sigScale = maxW/vp1.width;
    const vp = page.getViewport({scale:state._sigScale});
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    state._sigPageCanvas = c; state._sigPageNum = pageNum;
    container.innerHTML = '';
    const wrap = document.createElement('div'); wrap.className = 'sig-wrap';
    wrap.appendChild(state._sigPageCanvas);
    const item = document.createElement('div'); item.className='sig-item'; item.style.display='none';
    const img = document.createElement('img'); img.id='sigImg'; img.alt=''; img.draggable=false;
    item.appendChild(img);
    ['nw','ne','sw','se','rot'].forEach(kind=>{ const h=document.createElement('div'); h.className='sig-handle h-'+kind; h.dataset.kind=kind; item.appendChild(h); });
    wrap.appendChild(item);
    container.appendChild(wrap);

    item.addEventListener('pointerdown',(e)=>{
      if(e.target.classList.contains('sig-handle'))return;
      if(img.style.display==='none')return;
      item.classList.add('active'); e.preventDefault();
      try{ item.setPointerCapture(e.pointerId); }catch(_){}
      const r = item.getBoundingClientRect();
      const offX = e.clientX-r.left, offY = e.clientY-r.top;
      const onMove = (ev)=>{
        const wrapRect = wrap.getBoundingClientRect();
        const wpx = parseFloat(item.style.width)||0, hpx = parseFloat(item.style.height)||0;
        let nl = ev.clientX-wrapRect.left-offX, nt = ev.clientY-wrapRect.top-offY;
        nl = Math.max(0,Math.min(wrapRect.width-wpx,nl));
        nt = Math.max(0,Math.min(wrapRect.height-hpx,nt));
        item.style.left = nl+'px'; item.style.top = nt+'px';
        const pxPerCm = state._sigScale*CM;
        const xI = dom.options.querySelector('#sigX'), yI = dom.options.querySelector('#sigY');
        if(xI)xI.value = (nl/pxPerCm).toFixed(2);
        if(yI)yI.value = ((state._sigPageCanvas.height-nt-hpx)/pxPerCm).toFixed(2);
      };
      const onUp = ()=>{ item.removeEventListener('pointermove',onMove); item.removeEventListener('pointerup',onUp); item.removeEventListener('pointercancel',onUp); };
      item.addEventListener('pointermove',onMove);
      item.addEventListener('pointerup',onUp);
      item.addEventListener('pointercancel',onUp);
    });

    item.querySelectorAll('.sig-handle').forEach(h=>{
      h.addEventListener('pointerdown',(e)=>{
        e.preventDefault(); e.stopPropagation();
        item.classList.add('active');
        try{ h.setPointerCapture(e.pointerId); }catch(_){}
        const kind = h.dataset.kind;
        const startRect = item.getBoundingClientRect();
        const wrapRect = wrap.getBoundingClientRect();
        const startW = startRect.width, startH = startRect.height;
        const startL = startRect.left-wrapRect.left, startT = startRect.top-wrapRect.top;
        const cx = startL+startW/2, cy = startT+startH/2;
        const ratio = startH/startW || 1;
        const pxPerCm = state._sigScale*CM;
        const onMove = (ev)=>{
          if(kind==='rot'){
            const dx = ev.clientX-wrapRect.left-cx;
            const dy = ev.clientY-wrapRect.top-cy;
            let deg = Math.atan2(dy,dx)*180/Math.PI+90;
            if(deg>180)deg-=360; if(deg<-180)deg+=360;
            state._sigAngle = Math.round(deg);
            item.style.transform = 'rotate('+state._sigAngle+'deg)';
            const angEl = dom.options.querySelector('#sigAngleInput'); if(angEl)angEl.value = state._sigAngle;
            return;
          }
          const mx = ev.clientX-wrapRect.left;
          const dist = Math.abs(mx-cx);
          let newW = Math.max(40,dist*2);
          let newH = newW*ratio;
          newW = Math.min(newW,wrapRect.width);
          newH = Math.min(newH,wrapRect.height);
          item.style.width = newW+'px'; item.style.height = newH+'px';
          let newL = cx-newW/2, newT = cy-newH/2;
          newL = Math.max(0,Math.min(wrapRect.width-newW,newL));
          newT = Math.max(0,Math.min(wrapRect.height-newH,newT));
          item.style.left = newL+'px'; item.style.top = newT+'px';
          const xI = dom.options.querySelector('#sigX'), yI = dom.options.querySelector('#sigY');
          const wI = dom.options.querySelector('#sigW'), hI = dom.options.querySelector('#sigH');
          if(wI)wI.value = (newW/pxPerCm).toFixed(2);
          if(hI){ hI.dataset.touched='1'; hI.value = (newH/pxPerCm).toFixed(2); }
          if(xI)xI.value = (newL/pxPerCm).toFixed(2);
          if(yI)yI.value = ((state._sigPageCanvas.height-newT-newH)/pxPerCm).toFixed(2);
        };
        const onUp = ()=>{ h.removeEventListener('pointermove',onMove); h.removeEventListener('pointerup',onUp); h.removeEventListener('pointercancel',onUp); };
        h.addEventListener('pointermove',onMove);
        h.addEventListener('pointerup',onUp);
        h.addEventListener('pointercancel',onUp);
      });
    });
    wrap.addEventListener('pointerdown',(e)=>{ if(!item.contains(e.target))item.classList.remove('active'); });
  }
  const hInput = dom.options.querySelector('#sigH');
  if(hInput) hInput.dataset.touched = '';
  hInput && hInput.addEventListener('input',()=>{ hInput.dataset.touched='1'; },{once:true});
  updateSignatureImage();
  updateSignaturePosition();
}
async function insertSignature(){
  const sigURL = getSignatureDataURL();
  if(!sigURL)throw new Error('Dibuja tu firma primero.');
  const checked = [...dom.options.querySelectorAll('#sigPages input[type=checkbox]:checked')].map(cb=>parseInt(cb.value,10)).filter(n=>n>=1&&n<=state.pdfDoc.numPages);
  if(!checked.length)throw new Error('Selecciona al menos una página.');
  const wCm = parseFloat(dom.options.querySelector('#sigW').value)||5;
  const hCm = parseFloat(dom.options.querySelector('#sigH').value)||2.5;
  const xCm = parseFloat(dom.options.querySelector('#sigX').value)||0;
  const yCm = parseFloat(dom.options.querySelector('#sigY').value)||0;
  const p = busy('Insertando firma…');
  try{
    const pdf = await window.PDFLib.PDFDocument.load(await state.loadedFiles[0].arrayBuffer(),{ignoreEncryption:true});
    const base64 = sigURL.split(',')[1];
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++)bytes[i] = bin.charCodeAt(i);
    const png = await pdf.embedPng(bytes);
    for(const n of checked){
      p.check();
      const page = pdf.getPage(n-1);
      const opts = {x:xCm*CM, y:yCm*CM, width:wCm*CM, height:hCm*CM};
      if(state._sigAngle) opts.rotate = window.PDFLib.degrees(state._sigAngle);
      page.drawImage(png, opts);
      p.set(50+checked.indexOf(n)/checked.length*40, 'Firmando pág '+n+'…');
    }
    const out = await pdf.save();
    await dl(out, base(state.loadedFiles[0].name)+'_firmado.pdf');
    p.done('PDF firmado.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}