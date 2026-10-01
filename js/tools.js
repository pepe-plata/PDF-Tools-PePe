/* ==========================================================================
   tools.js — Todas las funciones de herramientas
   ========================================================================== */
import {
  CM, SHEET_SIZES, state, dom,
  msg, esc, fileSize, base, parseRange, busy, dl, fileKind, KIND_ICON,
  safeText, resolveSheetSizeCM, imageToCanvas, appendTextPages,
  renderThumbOnPage, hexToRgb, isPdf
} from './app.js';

/* ---------- Acción común ---------- */
export function renderAction(label, fn){
  const d = document.createElement('div');
  d.className = 'actions';
  const b = document.createElement('button');
  b.className = 'primary';
  b.textContent = label;
  b.onclick = async () => {
    try{
      if(!window.PDFLib || !window.pdfjsLib) throw window.__engineError||new Error('Motores no disponibles');
      await fn();
    }catch(e){ if(e.message!=='__CANCEL__') msg(e.message); }
  };
  d.appendChild(b);
  dom.preview.appendChild(d);
}

/* ---------- Lista de archivos ---------- */
export function renderFileList(fs){
  // revoca thumbs
  state.thumbUrls.forEach(u=>{try{URL.revokeObjectURL(u)}catch(_){}});
  state.thumbUrls = [];
  const reorder = (state.current==='merge'||state.current==='mixpdf');
  const multi = (state.current==='merge'||state.current==='mixpdf'||state.current==='imagepdf');
  dom.preview.innerHTML = '<div class="section">Archivos ('+fs.length+')</div><div class="file-list" id="fl"></div>';
  const fl = dom.preview.querySelector('#fl');
  fs.forEach((f,i)=>{
    const kind = fileKind(f);
    const d = document.createElement('div');
    d.className = 'file-item';
    let meta = fileSize(f.size);
    if(kind==='pdf'){
      const pc = state.pageCounts.get(f);
      const pcTxt = pc===undefined?'…':(pc===null?'?':pc);
      meta += ' · '+pcTxt+' pág';
    }
    d.innerHTML =
      '<span class="file-thumb" data-i="'+i+'">'+(KIND_ICON[kind]||'📄')+'</span>'+
      '<span class="name">'+esc(f.name)+'</span>'+
      '<span class="file-size">'+meta+'</span>'+
      (reorder?'<button class="mini" type="button" data-a="up">↑</button><button class="mini" type="button" data-a="down">↓</button>':'')+
      '<button class="mini del" type="button" data-a="del">✕</button>';
    if(reorder){ d.querySelector('[data-a="up"]').onclick=()=>moveFile(i,-1); d.querySelector('[data-a="down"]').onclick=()=>moveFile(i,1); }
    d.querySelector('[data-a="del"]').onclick = () => removeFile(i);
    fl.appendChild(d);
  });
  fs.forEach((f,i)=>{
    if(fileKind(f)!=='image')return;
    const el = fl.querySelector('.file-thumb[data-i="'+i+'"]');
    if(!el)return;
    const url = URL.createObjectURL(f);
    state.thumbUrls.push(url);
    const test = new Image();
    test.onload = () => { el.style.backgroundImage='url("'+url+'")'; };
    test.src = url;
  });
  if(multi && fs.length>1){
    const clearBtn = document.createElement('button');
    clearBtn.type='button'; clearBtn.className='danger'; clearBtn.textContent='Quitar todos ('+fs.length+')';
    clearBtn.style.marginTop='8px'; clearBtn.style.width='100%';
    clearBtn.onclick = () => { state.loadedFiles=[]; dom.preview.innerHTML='<div class="section">Archivos (0)</div>'; };
    dom.preview.appendChild(clearBtn);
  }
  if(state.current==='merge') renderAction('Unir PDF', makeMerge);
  if(state.current==='mixpdf') renderAction('Crear PDF combinado', makeMixPdf);
  if(state.current==='imagepdf') renderAction('Crear PDF', makeImagePdf);
}
export function moveFile(i,delta){const j=i+delta;if(j<0||j>=state.loadedFiles.length)return;[state.loadedFiles[i],state.loadedFiles[j]]=[state.loadedFiles[j],state.loadedFiles[i]];renderFileList(state.loadedFiles)}
export function removeFile(i){state.loadedFiles.splice(i,1);if(!state.loadedFiles.length)dom.preview.innerHTML='';else renderFileList(state.loadedFiles)}
export async function refreshPageCounts(){
  const pending = state.loadedFiles.filter(f=>fileKind(f)==='pdf'&&state.pageCounts.get(f)===undefined);
  if(!pending.length)return;
  if(!window.PDFLib)return;
  for(const f of pending){
    try{
      const src = await window.PDFLib.PDFDocument.load(await f.arrayBuffer(),{ignoreEncryption:true,updateMetadata:false});
      state.pageCounts.set(f, src.getPageCount());
    }catch(e){ state.pageCounts.set(f,null); }
  }
  if((state.current==='merge'||state.current==='mixpdf') && !dom.tool.classList.contains('hidden') && state.loadedFiles.length) renderFileList(state.loadedFiles);
}

/* ---------- Visor PDF ---------- */
export async function loadViewerPdf(f){
  if(!window.pdfjsLib) throw new Error('pdf.js no disponible');
  dom.preview.innerHTML = '<div class="status">Cargando PDF…</div>';
  try{
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    state._viewerPage = 1; state._viewerScale = 1.0;
    renderViewer();
  }catch(e){ msg('No se pudo abrir el PDF: '+e.message); }
}
function renderViewer(){
  dom.preview.innerHTML =
    '<div class="viewer">'+
      '<div class="viewer-toolbar">'+
        '<button type="button" id="v-prev" title="Anterior">◀</button>'+
        '<button type="button" id="v-next" title="Siguiente">▶</button>'+
        '<span id="v-page">'+state._viewerPage+' / '+state.pdfDoc.numPages+'</span>'+
        '<button type="button" id="v-zin" title="Acercar">＋</button>'+
        '<button type="button" id="v-zout" title="Alejar">−</button>'+
        '<button type="button" id="v-z1" title="100%">1:1</button>'+
        '<span id="v-scale">'+Math.round(state._viewerScale*100)+'%</span>'+
      '</div>'+
      '<div class="viewer-canvas-wrap" id="v-wrap"><canvas id="v-canvas"></canvas></div>'+
    '</div>';
  dom.preview.querySelector('#v-prev').onclick = () => { if(state._viewerPage>1){ state._viewerPage--; renderViewerCanvas(); } };
  dom.preview.querySelector('#v-next').onclick = () => { if(state._viewerPage<state.pdfDoc.numPages){ state._viewerPage++; renderViewerCanvas(); } };
  dom.preview.querySelector('#v-zin').onclick = () => { state._viewerScale = Math.min(4, state._viewerScale*1.2); renderViewerCanvas(); };
  dom.preview.querySelector('#v-zout').onclick = () => { state._viewerScale = Math.max(.2, state._viewerScale/1.2); renderViewerCanvas(); };
  dom.preview.querySelector('#v-z1').onclick = () => { state._viewerScale = 1; renderViewerCanvas(); };
  renderViewerCanvas();
}
async function renderViewerCanvas(){
  const canvas = dom.preview.querySelector('#v-canvas');
  if(!canvas)return;
  const page = await state.pdfDoc.getPage(state._viewerPage);
  const wrap = dom.preview.querySelector('#v-wrap');
  const baseW = Math.min(wrap.clientWidth-20, 1200);
  const vp1 = page.getViewport({scale:1});
  const fitScale = baseW/vp1.width;
  const scale = fitScale*state._viewerScale;
  const vp = page.getViewport({scale});
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  await page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise;
  dom.preview.querySelector('#v-page').textContent = state._viewerPage+' / '+state.pdfDoc.numPages;
  dom.preview.querySelector('#v-scale').textContent = Math.round(state._viewerScale*100)+'%';
}

/* ---------- Rotar páginas ---------- */
export async function loadRotatePdf(f){
  if(!window.pdfjsLib) throw new Error('pdf.js no disponible');
  dom.preview.innerHTML = '<div class="status">Cargando PDF…</div>';
  try{
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    state._rotSet = new Set();
    renderRotateGrid();
  }catch(e){ msg('No se pudo abrir el PDF: '+e.message); }
}
export function renderRotateGrid(){
  dom.preview.innerHTML = '<div class="section">Páginas: '+state.pdfDoc.numPages+' · marcadas: '+state._rotSet.size+'</div><div class="thumbs" id="rotGrid"></div>';
  const grid = dom.preview.querySelector('#rotGrid');
  for(let n=1;n<=state.pdfDoc.numPages;n++){
    const b = document.createElement('button');
    b.className = 'thumb'+(state._rotSet.has(n)?' selected':'');
    b.innerHTML = '<canvas></canvas><small>Página '+n+'</small>';
    if(state._rotSet.has(n)) b.insertAdjacentHTML('beforeend','<span class="check">✓</span>');
    b.onclick = () => { state._rotSet.has(n)?state._rotSet.delete(n):state._rotSet.add(n); renderRotateGrid(); };
    grid.appendChild(b);
    renderThumbOnPage(state.pdfDoc, n, b.querySelector('canvas'));
  }
}
export async function applyRotate(){
  const angleInput = dom.options.querySelector('#rot-angle');
  const signInput = dom.options.querySelector('#rot-sign');
  const amount = (parseFloat(angleInput.value)||90)*(parseInt(signInput.value,10)||1);
  const targetPages = state._rotSet.size ? [...state._rotSet] : Array.from({length:state.pdfDoc.numPages},(_,i)=>i+1);
  const p = busy('Rotando páginas…');
  try{
    const src = await window.PDFLib.PDFDocument.load(await state.loadedFiles[0].arrayBuffer(),{ignoreEncryption:true});
    for(const n of targetPages){
      p.check();
      const page = src.getPage(n-1);
      const cur = page.getRotation().angle;
      page.setRotation(window.PDFLib.degrees(((cur+amount)%360+360)%360));
      p.set(30+targetPages.indexOf(n)/targetPages.length*60,'Página '+n+'…');
    }
    p.set(95,'Guardando…');
    await dl(await src.save(), base(state.loadedFiles[0].name)+'_rotado.pdf');
    p.done('Páginas rotadas correctamente.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ---------- Dividir PDF ---------- */
export async function loadDividePdf(f){
  if(!window.pdfjsLib) throw new Error('pdf.js no disponible');
  dom.preview.innerHTML = '<div class="status">Cargando PDF…</div>';
  try{
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    const meta = await state.pdfDoc.getMetadata().catch(()=>({info:{}}));
    const info = meta.info||{};
    const mod = info.ModDate ? formatPdfDate(info.ModDate) : '—';
    dom.preview.innerHTML =
      '<div class="section">Información del documento</div>'+
      '<div class="panel">'+
        '<div><b>Archivo:</b> '+esc(state.loadedFiles[0].name)+'</div>'+
        '<div><b>Páginas:</b> '+state.pdfDoc.numPages+'</div>'+
        '<div><b>Tamaño:</b> '+fileSize(state.loadedFiles[0].size)+'</div>'+
        '<div><b>Modificado:</b> '+mod+'</div>'+
      '</div>';
  }catch(e){ msg('No se pudo abrir el PDF: '+e.message); }
}
function formatPdfDate(s){
  const m = /D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(s);
  if(!m)return s;
  return new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6]).toLocaleString();
}
export async function applyDivide(){
  const mode = dom.options.querySelector('#div-mode').value;
  const p = busy('Dividiendo PDF…');
  try{
    const srcBytes = await state.loadedFiles[0].arrayBuffer();
    const src = await window.PDFLib.PDFDocument.load(srcBytes,{ignoreEncryption:true});
    const total = src.getPageCount();
    const zip = new window.JSZip();
    let tasks = [];
    if(mode==='ranges'){
      const raw = (dom.options.querySelector('#div-ranges').value||'').trim();
      if(!raw)throw new Error('Introduce al menos un rango.');
      const lines = raw.split('\n').map(x=>x.trim()).filter(Boolean);
      let counter = 1;
      for(const line of lines){
        let name = null, range = line;
        const idx = line.indexOf(':');
        if(idx>=0){ name = line.slice(0,idx).trim(); range = line.slice(idx+1).trim(); }
        const pages = parseRange(range, total);
        if(!pages.length)continue;
        tasks.push({name:(name||('parte'+(counter++))), pages});
      }
      if(!tasks.length)throw new Error('Ningún rango válido.');
    }else{
      const npp = Math.max(1, parseInt(dom.options.querySelector('#div-npp').value,10)||1);
      let idx = 1;
      for(let start=1; start<=total; start+=npp){
        const end = Math.min(total, start+npp-1);
        const pages = [];
        for(let n=start; n<=end; n++) pages.push(n);
        tasks.push({name:'parte'+idx, pages});
        idx++;
      }
    }
    for(let t=0;t<tasks.length;t++){
      p.check();
      const task = tasks[t];
      p.set(20+t/tasks.length*70, 'Generando '+task.name+' ('+task.pages.length+' pág)…');
      const out = await window.PDFLib.PDFDocument.create();
      const copied = await out.copyPages(src, task.pages.map(n=>n-1));
      copied.forEach(pg=>out.addPage(pg));
      const bytes = await out.save();
      zip.file(task.name+'.pdf', bytes);
    }
    p.set(95,'Comprimiendo ZIP…');
    const blob = await zip.generateAsync({type:'blob'});
    await dl(await blob.arrayBuffer(), base(state.loadedFiles[0].name)+'_dividido.zip','application/zip');
    p.done('PDF dividido en '+tasks.length+' archivo(s).');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ---------- Cargar PDF genérico (extract / image / extractimg) ---------- */
export async function loadPdf(f){
  if(!window.PDFLib||!window.pdfjsLib) throw new Error('Motores no disponibles');
  dom.preview.innerHTML = '<div class="status">Cargando PDF…</div>';
  try{
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    state.selected = new Set(Array.from({length:state.pdfDoc.numPages},(_,i)=>i+1));
    renderThumbs();
  }catch(e){ msg('No se pudo abrir el PDF: '+e.message); }
}
function renderThumbs(){
  dom.preview.innerHTML = '<div class="section">Páginas: '+state.pdfDoc.numPages+'</div><div class="selected-count" id="selectedCount"></div><div class="thumbs" id="thumbs"></div>';
  updateSelectedCount();
  const box = dom.preview.querySelector('#thumbs');
  for(let n=1;n<=state.pdfDoc.numPages;n++){
    const b = document.createElement('button');
    b.className = 'thumb'+(state.selected.has(n)?' selected':'');
    b.innerHTML = '<canvas></canvas><small>Página '+n+'</small>';
    if(state.selected.has(n)) b.insertAdjacentHTML('beforeend','<span class="check">✓</span>');
    b.onclick = () => togglePage(n,b);
    box.appendChild(b);
    renderThumbOnPage(state.pdfDoc, n, b.querySelector('canvas'));
  }
  if(state.current==='extract'||state.current==='extractimg'){
    const all = document.querySelector('#all'), none = document.querySelector('#none');
    if(all) all.onclick = () => { state.selected = new Set(Array.from({length:state.pdfDoc.numPages},(_,i)=>i+1)); renderThumbs(); };
    if(none) none.onclick = () => { state.selected.clear(); renderThumbs(); };
  }
  if(state.current==='extract') renderAction('Crear PDF', makeExtract);
  else if(state.current==='extractimg') renderAction('Extraer imágenes', makeExtractImages);
  else renderAction('Exportar páginas', makeImages);
}
function updateSelectedCount(){const e=dom.preview.querySelector('#selectedCount');if(e)e.textContent=state.selected.size+' de '+state.pdfDoc.numPages+' páginas'}
function togglePage(n,b){state.selected.has(n)?state.selected.delete(n):state.selected.add(n);b.classList.toggle('selected',state.selected.has(n));b.querySelector('.check')?.remove();if(state.selected.has(n))b.insertAdjacentHTML('beforeend','<span class="check">✓</span>');updateSelectedCount()}

/* ---------- Extraer páginas ---------- */
export async function makeExtract(){
  const p = busy('Preparando…');
  try{
    const nums = parseRange(dom.options.querySelector('#range').value, state.pdfDoc.numPages);
    const final = nums.length ? nums : [...state.selected].sort((a,b)=>a-b);
    if(!final.length) throw new Error('Selecciona al menos una página.');
    p.set(10,'Cargando PDF…');
    const src = await window.PDFLib.PDFDocument.load(await state.loadedFiles[0].arrayBuffer(),{ignoreEncryption:true});
    p.check();
    const out = await window.PDFLib.PDFDocument.create();
    const pages = await out.copyPages(src, final.map(n=>n-1));
    pages.forEach((x,i)=>{p.check();out.addPage(x);p.set(65+(i+1)/pages.length*25,'Construyendo…')});
    p.set(95,'Guardando…');
    await dl(await out.save(), base(state.loadedFiles[0].name)+'_extraido.pdf');
    p.done('PDF creado correctamente.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ---------- Unir PDF ---------- */
export async function makeMerge(){
  const p = busy('Preparando…');
  try{
    const out = await window.PDFLib.PDFDocument.create();
    for(let i=0;i<state.loadedFiles.length;i++){
      p.check();
      p.set(i/state.loadedFiles.length*90,'Procesando '+(i+1)+'/'+state.loadedFiles.length+'…');
      const src = await window.PDFLib.PDFDocument.load(await state.loadedFiles[i].arrayBuffer(),{ignoreEncryption:true});
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(x=>out.addPage(x));
    }
    p.set(95,'Guardando…');
    await dl(await out.save(),'PDF_unido.pdf');
    state.loadedFiles = [];
    const keep = p.el;
    dom.preview.innerHTML = '';
    dom.preview.appendChild(keep);
    p.done('PDF creado correctamente.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ---------- PDF → Imagen ---------- */
export async function makeImages(){
  const fmt = dom.options.querySelector('#fmt').value;
  const dpi = +dom.options.querySelector('#dpi').value;
  const scale = dpi/72;
  const nums = [...state.selected].sort((a,b)=>a-b);
  if(!nums.length)throw new Error('Selecciona al menos una página.');
  const p = busy('Exportando…');
  try{
    const zip = typeof window.JSZip!=='undefined' ? new window.JSZip() : null;
    for(let i=0;i<nums.length;i++){
      p.check();
      const n = nums[i];
      const page = await state.pdfDoc.getPage(n);
      const v = page.getViewport({scale});
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(v.width); canvas.height = Math.ceil(v.height);
      await page.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;
      const mime = fmt==='PNG' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise(r=>canvas.toBlob(r,mime,.92));
      const name = 'pagina-'+n+'.'+fmt.toLowerCase();
      if(zip) zip.file(name, blob); else await dl(await blob.arrayBuffer(), name, mime);
      p.set((i+1)/nums.length*90, 'Página '+n+' de '+nums.length);
    }
    if(zip){
      p.set(95,'Creando ZIP…');
      await dl(await zip.generateAsync({type:'blob'}), 'PDF_imagenes.zip', 'application/zip');
    }
    p.done('Exportación completada.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ---------- Imagen → PDF (con conservar relación de aspecto) ---------- */
export async function makeImagePdf(){
  const sheetSel = dom.options.querySelector('#size').value;
  const orient = dom.options.querySelector('#orient').value;
  const sheetWcm = parseFloat(dom.options.querySelector('#sheet-w')?.value)||21.59;
  const sheetHcm = parseFloat(dom.options.querySelector('#sheet-h')?.value)||27.94;
  const [pgW,pgH] = resolveSheetSizeCM(sheetSel, orient, sheetWcm, sheetHcm);

  const imgSel = dom.options.querySelector('#imgsize').value;
  let imgWcm = null, imgHcm = null;
  if(imgSel==='custom'){
    imgWcm = parseFloat(dom.options.querySelector('#imgw').value);
    imgHcm = parseFloat(dom.options.querySelector('#imgh').value);
    if(isNaN(imgWcm)||imgWcm<=0)imgWcm=10;
    if(isNaN(imgHcm)||imgHcm<=0)imgHcm=15;
  }else if(imgSel!=='auto'){
    const s = SHEET_SIZES[imgSel];
    if(s){ imgWcm = s.w; imgHcm = s.h; }
  }

  const keepAspect = dom.options.querySelector('#keep-aspect')?.checked !== false;

  const posV = dom.options.querySelector('#pos-v').value;
  const posH = dom.options.querySelector('#pos-h').value;
  const posXcm = parseFloat(dom.options.querySelector('#pos-x').value)||0;
  const posYcm = parseFloat(dom.options.querySelector('#pos-y').value)||0;
  let marginCm = parseFloat(dom.options.querySelector('#pdf-margin').value);
  if(isNaN(marginCm))marginCm = 0.6;
  const marginPt = marginCm*CM;

  const p = busy('Creando PDF…');
  try{
    const out = await window.PDFLib.PDFDocument.create();
    for(let i=0;i<state.loadedFiles.length;i++){
      p.check();
      const {canvas,width:iw,height:ih} = await imageToCanvas(state.loadedFiles[i]);

      // Calcular tamaño final (dw,dh) respetando "keepAspect"
      let dw,dh;
      if(imgWcm&&imgHcm){
        const boxW = imgWcm*CM, boxH = imgHcm*CM;
        if(keepAspect){
          const srcRatio = iw / ih;
          const boxRatio = boxW / boxH;
          if(srcRatio > boxRatio){
            // La imagen es más ancha: ajusta al ancho, alto proporcional
            dw = boxW;
            dh = boxW / srcRatio;
          }else{
            dh = boxH;
            dw = boxH * srcRatio;
          }
        }else{
          dw = boxW; dh = boxH;
        }
      }else{
        // auto: ajustar a la hoja completa descontando márgenes
        const availW = Math.max(1,pgW-marginPt*2);
        const availH = Math.max(1,pgH-marginPt*2);
        const k = Math.min(availW/canvas.width, availH/canvas.height);
        dw = canvas.width*k;
        dh = canvas.height*k;
      }

      // Calcular posición X
      let x;
      if(posH==='custom') x = posXcm*CM;
      else if(posH==='center') x = (pgW-dw)/2;
      else if(posH==='right') x = pgW-marginPt-dw;
      else x = marginPt;

      // Calcular posición Y (desde arriba; pdf-lib usa origen abajo-izquierda)
      let yTop;
      if(posV==='custom') yTop = posYcm*CM;
      else if(posV==='center') yTop = (pgH-dh)/2;
      else if(posV==='bottom') yTop = pgH-marginPt-dh;
      else yTop = marginPt;
      const yPdf = pgH - yTop - dh;

      const page = out.addPage([pgW, pgH]);
      const png = await new Promise(r=>canvas.toBlob(r,'image/png'));
      const emb = await out.embedPng(await png.arrayBuffer());
      page.drawImage(emb, {x, y:yPdf, width:dw, height:dh});
      p.set((i+1)/state.loadedFiles.length*90, 'Imagen '+(i+1)+'/'+state.loadedFiles.length);
    }
    p.set(95,'Guardando…');
    await dl(await out.save(), 'imagenes.pdf');
    p.done('PDF creado correctamente.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ---------- Combinar en PDF ---------- */
export async function makeMixPdf(){
  const sheetSel = dom.options.querySelector('#size').value;
  const orient = dom.options.querySelector('#orient').value;
  const customWcm = parseFloat(dom.options.querySelector('#mixw')?.value)||21.59;
  const customHcm = parseFloat(dom.options.querySelector('#mixh')?.value)||27.94;
  let marginCm = parseFloat(dom.options.querySelector('#mix-margin').value);
  if(isNaN(marginCm))marginCm = 0.6;
  const marginPt = marginCm*CM;

  const p = busy('Creando PDF…');
  try{
    const total = state.loadedFiles.length;
    if(!total)throw new Error('Selecciona al menos un archivo.');
    const out = await window.PDFLib.PDFDocument.create();
    const font = await out.embedFont(window.PDFLib.StandardFonts.Helvetica);
    for(let i=0;i<total;i++){
      p.check();
      const f = state.loadedFiles[i];
      const kind = fileKind(f);
      p.set(i/total*92, '('+(i+1)+'/'+total+') '+f.name);
      if(kind==='pdf'){
        const src = await window.PDFLib.PDFDocument.load(await f.arrayBuffer(),{ignoreEncryption:true});
        const copied = await out.copyPages(src, src.getPageIndices());
        copied.forEach(pg=>out.addPage(pg));
      }else if(kind==='image'){
        const {canvas,width,height} = await imageToCanvas(f);
        let pw,ph;
        if(sheetSel==='Automático'){ pw=width; ph=height; }
        else [pw,ph] = resolveSheetSizeCM(sheetSel, orient, customWcm, customHcm);
        const page = out.addPage([pw,ph]);
        const blob = await new Promise(r=>canvas.toBlob(r,'image/png'));
        const png = await out.embedPng(await blob.arrayBuffer());
        const availW = Math.max(1,pw-marginPt*2);
        const availH = Math.max(1,ph-marginPt*2);
        const k = Math.min(availW/canvas.width, availH/canvas.height);
        const dw = canvas.width*k, dh = canvas.height*k;
        page.drawImage(png, {x:(pw-dw)/2, y:(ph-dh)/2, width:dw, height:dh});
      }else if(kind==='text'){
        const txt = await f.text();
        let pw,ph;
        if(sheetSel==='Automático'){ pw=595.28; ph=841.89; }
        else [pw,ph] = resolveSheetSizeCM(sheetSel, orient, customWcm, customHcm);
        appendTextPages(out, font, txt, pw, ph, marginPt);
      }else throw new Error('Formato no compatible: '+f.name);
      p.check();
    }
    p.set(95,'Guardando…');
    await dl(await out.save(), 'PDF_combinado.pdf');
    state.loadedFiles = [];
    const keep = p.el;
    dom.preview.innerHTML = '';
    dom.preview.appendChild(keep);
    p.done('PDF creado correctamente.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ---------- TXT / HTML ---------- */
export async function makeTxtPdf(){
  const p = busy('Creando PDF…');
  try{
    const text = await state.loadedFiles[0].text();
    const out = await window.PDFLib.PDFDocument.create();
    const font = await out.embedFont(window.PDFLib.StandardFonts.Helvetica);
    appendTextPages(out, font, text, 612, 792, 0.6*CM);
    await dl(await out.save(), base(state.loadedFiles[0].name)+'.pdf');
    p.done('PDF creado correctamente.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}
export async function printHtml(){
  const html = await state.loadedFiles[0].text();
  const w = window.open('','_blank');
  if(!w)throw new Error('El navegador bloqueó la ventana.');
  w.document.open(); w.document.write(html); w.document.close(); w.focus();
  setTimeout(()=>w.print(),500);
}

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

/* ---------- Reordenar ---------- */
export async function loadReorderPdf(f){
  if(!window.pdfjsLib) throw new Error('pdf.js no disponible');
  dom.preview.innerHTML = '<div class="status">Cargando PDF…</div>';
  try{
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    state._reorderOrder = Array.from({length:state.pdfDoc.numPages},(_,i)=>i+1);
    renderReorderGrid();
  }catch(e){ msg('No se pudo abrir: '+e.message); }
}
function renderReorderGrid(){
  dom.preview.innerHTML = '<div class="section">Reordenar páginas ('+state.pdfDoc.numPages+')</div><div class="reorder-grid" id="reoGrid"></div>';
  const grid = dom.preview.querySelector('#reoGrid');
  state._reorderOrder.forEach((orig,index)=>{
    const d = document.createElement('div');
    d.className = 'reorder-card'; d.draggable = true; d.dataset.idx = index;
    d.innerHTML = '<canvas></canvas><span class="ord">'+(index+1)+'</span><span class="orig">original: pág '+orig+'</span><div class="nav"><button type="button" data-a="left">←</button><button type="button" data-a="right">→</button></div>';
    grid.appendChild(d);
    renderThumbOnPage(state.pdfDoc, orig, d.querySelector('canvas'));
    d.querySelector('[data-a="left"]').onclick = () => reorderMove(index,-1);
    d.querySelector('[data-a="right"]').onclick = () => reorderMove(index,1);
    d.addEventListener('dragstart',(e)=>{d.classList.add('dragging');e.dataTransfer.setData('text/plain',String(index))});
    d.addEventListener('dragend',()=>{d.classList.remove('dragging');grid.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'))});
    d.addEventListener('dragover',(e)=>{e.preventDefault();d.classList.add('drop-target')});
    d.addEventListener('dragleave',()=>d.classList.remove('drop-target'));
    d.addEventListener('drop',(e)=>{e.preventDefault();const from=parseInt(e.dataTransfer.getData('text/plain'),10);const to=index;if(!isNaN(from)&&from!==to){const m=state._reorderOrder.splice(from,1)[0];state._reorderOrder.splice(to,0,m);renderReorderGrid()}});
  });
  const d = document.createElement('div'); d.className = 'actions';
  const b = document.createElement('button'); b.className='primary'; b.type='button'; b.textContent='Guardar nuevo orden';
  b.onclick = () => applyReorder().catch(e=>{ if(e.message!=='__CANCEL__')msg(e.message); });
  d.appendChild(b); dom.preview.appendChild(d);
}
function reorderMove(i,delta){const j=i+delta;if(j<0||j>=state._reorderOrder.length)return;[state._reorderOrder[i],state._reorderOrder[j]]=[state._reorderOrder[j],state._reorderOrder[i]];renderReorderGrid()}
export async function applyReorder(){
  const p = busy('Aplicando orden…');
  try{
    const src = await window.PDFLib.PDFDocument.load(await state.loadedFiles[0].arrayBuffer(),{ignoreEncryption:true});
    const out = await window.PDFLib.PDFDocument.create();
    const copied = await out.copyPages(src, state._reorderOrder.map(n=>n-1));
    copied.forEach((pg,i)=>{p.check();out.addPage(pg);p.set(30+i/copied.length*60,'Añadiendo…')});
    p.set(95,'Guardando…');
    await dl(await out.save(), base(state.loadedFiles[0].name)+'_reordenado.pdf');
    p.done('PDF reordenado.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ---------- Borrar páginas ---------- */
export async function loadDeletePdf(f){
  if(!window.pdfjsLib) throw new Error('pdf.js no disponible');
  dom.preview.innerHTML = '<div class="status">Cargando PDF…</div>';
  try{
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    state._deleteSet = new Set();
    renderDeleteGrid();
  }catch(e){ msg('No se pudo abrir: '+e.message); }
}
function renderDeleteGrid(){
  dom.preview.innerHTML = '<div class="section">Páginas: '+state.pdfDoc.numPages+' · marcadas: '+state._deleteSet.size+'</div><div class="thumbs" id="delGrid"></div>';
  const grid = dom.preview.querySelector('#delGrid');
  for(let n=1;n<=state.pdfDoc.numPages;n++){
    const b = document.createElement('button');
    b.className = 'thumb'+(state._deleteSet.has(n)?' selected':'');
    if(state._deleteSet.has(n)) b.style.borderColor='var(--danger)';
    b.innerHTML = '<canvas></canvas><small>Página '+n+'</small>';
    if(state._deleteSet.has(n)) b.insertAdjacentHTML('beforeend','<span class="check" style="background:var(--danger)">✕</span>');
    b.onclick = () => { state._deleteSet.has(n)?state._deleteSet.delete(n):state._deleteSet.add(n); renderDeleteGrid(); };
    grid.appendChild(b);
    renderThumbOnPage(state.pdfDoc, n, b.querySelector('canvas'));
  }
}
export async function applyDeletePages(){
  if(!state._deleteSet.size)throw new Error('Marca al menos una página.');
  if(state._deleteSet.size>=state.pdfDoc.numPages)throw new Error('No puedes borrar todas.');
  const p = busy('Eliminando…');
  try{
    const src = await window.PDFLib.PDFDocument.load(await state.loadedFiles[0].arrayBuffer(),{ignoreEncryption:true});
    const out = await window.PDFLib.PDFDocument.create();
    const keep = [];
    for(let i=1;i<=state.pdfDoc.numPages;i++) if(!state._deleteSet.has(i)) keep.push(i-1);
    const copied = await out.copyPages(src, keep);
    copied.forEach(pg=>{p.check();out.addPage(pg)});
    p.set(95,'Guardando…');
    await dl(await out.save(), base(state.loadedFiles[0].name)+'_sin_paginas.pdf');
    p.done('Páginas eliminadas.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ---------- Marca de agua ---------- */
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
      '<label style="display:block;font-size:12px;color:var(--muted)">Imagen (PNG o JPG)<input id="wm-image" class="field" type="file" accept="image/png,image/jpeg"></label>'+
      '<div class="row">'+
        '<label>Ancho (cm)<input id="wm-iw" class="field" type="number" min="1" step="0.1" value="6"></label>'+
        '<label>Alto (cm)<input id="wm-ih" class="field" type="number" min="1" step="0.1" value="6"></label>'+
      '</div>';
    const inp = body.querySelector('#wm-image');
    inp.onchange = async () => { const f = inp.files && inp.files[0]; if(!f)return; state._wmImageBytes = new Uint8Array(await f.arrayBuffer()); renderWatermarkPreview(); };
  }else if(state._wmType==='pdf'){
    body.innerHTML =
      '<label style="display:block;font-size:12px;color:var(--muted)">PDF a superponer<input id="wm-pdf" class="field" type="file" accept="application/pdf"></label>'+
      '<label style="display:block;font-size:12px;color:var(--muted);margin-top:6px">Página del PDF<input id="wm-ppage" class="field" type="number" min="1" step="1" value="1"></label>'+
      '<div class="row">'+
        '<label>Ancho (cm)<input id="wm-iw" class="field" type="number" min="1" step="0.1" value="10"></label>'+
        '<label>Alto (cm)<input id="wm-ih" class="field" type="number" min="1" step="0.1" value="10"></label>'+
      '</div>';
    const inp = body.querySelector('#wm-pdf');
    inp.onchange = async () => { const f = inp.files && inp.files[0]; if(!f)return; state._wmPdfBytes = new Uint8Array(await f.arrayBuffer()); };
    const pg = body.querySelector('#wm-ppage');
    pg.oninput = () => { state._wmPdfPageNum = Math.max(1, parseInt(pg.value,10)||1); };
  }
  const common = document.createElement('div');
  common.innerHTML =
    '<div class="row">'+
      '<label>Opacidad (0–1)<input id="wm-opacity" class="field" type="number" min="0.05" max="1" step="0.05" value="0.25"></label>'+
      '<label>Rotación (°)<input id="wm-rot" class="field" type="number" min="-180" max="180" step="1" value="45"></label>'+
    '</div>'+
    '<label style="display:block;font-size:12px;color:var(--muted);margin-top:6px">Páginas (vacío = todas)<input id="wm-pages" class="field" type="text" placeholder="Ej.: 1,3,5-8"></label>'+
    '<div class="section">Vista previa</div>'+
    '<p class="note" style="margin:4px 0 8px">La marca se muestra sobre la hoja tal como quedará.</p>'+
    '<div id="wmPreview" style="margin-top:4px"></div>'+
    '<div class="row" style="margin-top:8px">'+
      '<label>Página de la vista previa<input id="wm-preview-page" class="field" type="number" min="1" step="1" value="1"></label>'+
    '</div>'+
    '<div class="actions"><button class="primary" type="button" id="wm-apply">Aplicar marca de agua</button></div>';
  body.appendChild(common);
  body.querySelector('#wm-apply').onclick = () => applyWatermark().catch(e=>{ if(e.message!=='__CANCEL__')msg(e.message); });
  const pp = body.querySelector('#wm-preview-page');
  pp.oninput = () => renderWatermarkPreview(true);
  ['wm-text','wm-size','wm-color','wm-opacity','wm-rot','wm-iw','wm-ih'].forEach(id=>{
    const el = body.querySelector('#'+id);
    if(el) el.oninput = () => renderWatermarkPreview();
  });
  renderWatermarkPreview();
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
  const opacity = parseFloat((dom.options.querySelector('#wm-opacity')||{}).value)||0.25;
  const rot = parseFloat((dom.options.querySelector('#wm-rot')||{}).value)||0;
  const overlay = document.createElement('div');
  overlay.style.position='relative'; overlay.style.display='inline-block'; overlay.style.lineHeight='0';
  overlay.appendChild(state._wmPageCanvas);

  if(state._wmType==='text'){
    const txt = (dom.options.querySelector('#wm-text')||{}).value||'CONFIDENCIAL';
    const size = parseFloat((dom.options.querySelector('#wm-size')||{}).value)||60;
    const color = (dom.options.querySelector('#wm-color')||{}).value||'#666666';
    const span = document.createElement('div');
    span.textContent = txt;
    span.style.position='absolute'; span.style.left='50%'; span.style.top='50%';
    span.style.transform = 'translate(-50%,-50%) rotate('+rot+'deg)';
    span.style.fontSize = (size*state._wmScale)+'px';
    span.style.color = color; span.style.opacity = String(opacity);
    span.style.fontWeight = '700'; span.style.whiteSpace = 'nowrap'; span.style.pointerEvents = 'none';
    overlay.appendChild(span);
  }else{
    const wcm = parseFloat((dom.options.querySelector('#wm-iw')||{}).value)||6;
    const hcm = parseFloat((dom.options.querySelector('#wm-ih')||{}).value)||6;
    const pxPerCm = state._wmScale*CM;
    const img = document.createElement('img');
    img.style.position='absolute'; img.style.left='50%'; img.style.top='50%';
    img.style.transform = 'translate(-50%,-50%) rotate('+rot+'deg)';
    img.style.width = (wcm*pxPerCm)+'px'; img.style.height = (hcm*pxPerCm)+'px';
    img.style.opacity = String(opacity); img.style.pointerEvents='none';
    if(state._wmType==='image'&&state._wmImageBytes){
      const blob = new Blob([state._wmImageBytes]);
      img.src = URL.createObjectURL(blob);
    }else if(state._wmType==='pdf'&&state._wmPdfBytes){
      try{
        const tdoc = await window.pdfjsLib.getDocument({data: state._wmPdfBytes.slice(0)}).promise;
        const tp = await tdoc.getPage(Math.max(1,Math.min(tdoc.numPages,state._wmPdfPageNum)));
        const tvp = tp.getViewport({scale:1});
        const tc = document.createElement('canvas'); tc.width = tvp.width; tc.height = tvp.height;
        await tp.render({canvasContext:tc.getContext('2d'),viewport:tvp}).promise;
        img.src = tc.toDataURL('image/png');
      }catch(e){}
    }
    overlay.appendChild(img);
  }
  container.innerHTML='';
  container.appendChild(overlay);
}
export async function applyWatermark(){
  const pagesInput = dom.options.querySelector('#wm-pages');
  const opacity = parseFloat(dom.options.querySelector('#wm-opacity').value)||0.25;
  const rotation = parseFloat(dom.options.querySelector('#wm-rot').value)||0;
  const pages = pagesInput&&pagesInput.value.trim()
    ? parseRange(pagesInput.value,state.pdfDoc.numPages)
    : Array.from({length:state.pdfDoc.numPages},(_,i)=>i+1);
  if(!pages.length)throw new Error('No hay páginas donde aplicar.');
  const p = busy('Aplicando marca…');
  try{
    const src = await window.PDFLib.PDFDocument.load(await state.loadedFiles[0].arrayBuffer(),{ignoreEncryption:true});
    let textFont=null,textColor=null,textSize=null,textStr=null;
    let imageEmb=null,wmImgW=0,wmImgH=0;
    if(state._wmType==='text'){
      textStr = dom.options.querySelector('#wm-text').value||'CONFIDENCIAL';
      textSize = parseFloat(dom.options.querySelector('#wm-size').value)||60;
      textColor = hexToRgb(dom.options.querySelector('#wm-color').value||'#666666');
      textFont = await src.embedFont(window.PDFLib.StandardFonts.HelveticaBold);
    }else if(state._wmType==='image'){
      if(!state._wmImageBytes)throw new Error('Selecciona imagen.');
      try{ imageEmb = await src.embedPng(state._wmImageBytes); }catch(_){ imageEmb = await src.embedJpg(state._wmImageBytes); }
      wmImgW = (parseFloat(dom.options.querySelector('#wm-iw').value)||6)*CM;
      wmImgH = (parseFloat(dom.options.querySelector('#wm-ih').value)||6)*CM;
    }else if(state._wmType==='pdf'){
      if(!state._wmPdfBytes)throw new Error('Selecciona PDF.');
      const stampSrc = await window.PDFLib.PDFDocument.load(state._wmPdfBytes,{ignoreEncryption:true});
      const total = stampSrc.getPageCount();
      const idx = Math.max(0, Math.min(total-1, state._wmPdfPageNum-1));
      const [embedded] = await src.embedPdf(state._wmPdfBytes, [idx]);
      imageEmb = embedded;
      wmImgW = (parseFloat(dom.options.querySelector('#wm-iw').value)||10)*CM;
      wmImgH = (parseFloat(dom.options.querySelector('#wm-ih').value)||10)*CM;
    }
    for(let i=0;i<pages.length;i++){
      p.check();
      const n = pages[i];
      const page = src.getPage(n-1);
      const {width:pgW,height:pgH} = page.getSize();
      if(state._wmType==='text'){
        const tw = textFont.widthOfTextAtSize(safeText(textStr), textSize);
        const th = textSize;
        const cx = pgW/2, cy = pgH/2;
        const a = rotation*Math.PI/180;
        const x = cx - (tw/2)*Math.cos(a) + (th/2)*Math.sin(a);
        const y = cy - (tw/2)*Math.sin(a) - (th/2)*Math.cos(a);
        page.drawText(safeText(textStr),{x,y,size:textSize,font:textFont,color:textColor,opacity:Math.max(0,Math.min(1,opacity)),rotate:window.PDFLib.degrees(rotation)});
      }else{
        page.drawImage(imageEmb,{x:(pgW-wmImgW)/2,y:(pgH-wmImgH)/2,width:wmImgW,height:wmImgH,opacity:Math.max(0,Math.min(1,opacity)),rotate:window.PDFLib.degrees(rotation)});
      }
      p.set(30+(i+1)/pages.length*60,'Página '+n+'…');
    }
    p.set(95,'Guardando…');
    await dl(await src.save(), base(state.loadedFiles[0].name)+'_marca_agua.pdf');
    p.done('Marca de agua aplicada.');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}

/* ---------- Llenar PDF ---------- */
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
  if(!state._fillPageCanvas || state._fillPageNum!==state._fillPageNum || force || !state._fillPageCanvas){
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
    el.innerHTML = '<span class="fill-text" style="font-size:'+(item.size*state._fillScale)+'px;font-weight:'+(item.bold?'700':'400')+';font-style:'+(item.italic?'italic':'normal')+';text-decoration:'+(item.underline?'underline':'none')+';color:'+item.color+';font-family:'+fontFamilyCSS(item.font)+'">'+esc(item.text||'(texto)')+'</span>'+
      '<span class="fill-handle"></span>';
    wrap.appendChild(el);
    el.addEventListener('pointerdown',(e)=>{
      state._fillSelectedIdx = idx;
      const kind = e.target.classList.contains('fill-handle') ? 'resize' : 'move';
      const startX = e.clientX, startY = e.clientY;
      const startXCm = item.x_cm, startYCm = item.y_cm, startSize = item.size;
      try{ el.setPointerCapture(e.pointerId); }catch(_){}
      const onMove = (ev)=>{
        const dx = (ev.clientX-startX)/(state._fillScale*CM);
        const dy = (ev.clientY-startY)/(state._fillScale*CM);
        if(kind==='move'){ item.x_cm = Math.max(0,startXCm+dx); item.y_cm = Math.max(0,startYCm+dy); }
        else{ item.size = Math.max(6, startSize+(dx)*4); }
        el.style.left = (item.x_cm*state._fillScale*CM)+'px';
        el.style.top = (item.y_cm*state._fillScale*CM)+'px';
        el.querySelector('.fill-text').style.fontSize = (item.size*state._fillScale)+'px';
      };
      const onUp = () => { el.removeEventListener('pointermove',onMove); el.removeEventListener('pointerup',onUp); el.removeEventListener('pointercancel',onUp); };
      el.addEventListener('pointermove',onMove);
      el.addEventListener('pointerup',onUp);
      el.addEventListener('pointercancel',onUp);
      e.preventDefault();
    });
  });
}
function fontFamilyCSS(f){
  if(f==='TimesRoman')return 'Times, serif';
  if(f==='Courier')return 'Courier New, monospace';
  return 'Helvetica, Arial, sans-serif';
}
export function addFillItem(page){
  state._fillItems.push({
    x_cm:2, y_cm:2,
    text:'Texto nuevo',
    size:parseFloat((dom.options.querySelector('#fl-size')||{}).value)||14,
    font:(dom.options.querySelector('#fl-font')||{}).value||'Helvetica',
    color:(dom.options.querySelector('#fl-color')||{}).value||'#000000',
    style:(dom.options.querySelector('#fl-style')||{}).value||'',
    bold:((dom.options.querySelector('#fl-style')||{}).value||'').includes('bold'),
    italic:((dom.options.querySelector('#fl-style')||{}).value||'').includes('italic'),
    underline:(dom.options.querySelector('#fl-underline')||{}).value==='1',
    page:state._fillPageNum
  });
  state._fillSelectedIdx = state._fillItems.length-1;
  renderFillPreview();
}
export async function applyFill(){
  if(!state._fillItems.length)throw new Error('Añade al menos un texto.');
  const p = busy('Insertando textos…');
  try{
    const pdf = await window.PDFLib.PDFDocument.load(await state.loadedFiles[0].arrayBuffer(),{ignoreEncryption:true});
    const fontsCache = {};
    async function getFont(name,bold,italic){
      const key = name+(bold?'B':'')+(italic?'I':'');
      if(fontsCache[key])return fontsCache[key];
      let std;
      const SF = window.PDFLib.StandardFonts;
      if(name==='TimesRoman')std = bold ? (italic?SF.TimesRomanBoldItalic:SF.TimesRomanBold) : (italic?SF.TimesRomanItalic:SF.TimesRoman);
      else if(name==='Courier')std = bold ? (italic?SF.CourierBoldOblique:SF.CourierBold) : (italic?SF.CourierOblique:SF.Courier);
      else std = bold ? (italic?SF.HelveticaBoldOblique:SF.HelveticaBold) : (italic?SF.HelveticaOblique:SF.Helvetica);
      const f = await pdf.embedFont(std);
      fontsCache[key] = f;
      return f;
    }
    for(const item of state._fillItems){
      p.check();
      const page = pdf.getPage(item.page-1);
      const {height:pgH} = page.getSize();
      const font = await getFont(item.font, item.bold, item.italic);
      const x = item.x_cm*CM;
      const y = pgH - (item.y_cm*CM) - item.size*0.9;
      const rgb = hexToRgb(item.color);
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

/* ---------- Firmar PDF con firmas guardadas ---------- */
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
  canvas.width = Math.max(1,Math.round(rect.width*dpr));
  canvas.height = Math.max(1,Math.round(rect.height*dpr));
  state.sigCtx = canvas.getContext('2d');
  state.sigCtx.setTransform(dpr,0,0,dpr,0,0);
  state.sigCtx.lineCap = 'round'; state.sigCtx.lineJoin = 'round';
  state.sigCtx.strokeStyle = state._sigColor; state.sigCtx.lineWidth = 2.4;
  state.sigHasStrokes = false;
  const getPos = (e) => { const r = canvas.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; };
  const start = (e) => { e.preventDefault(); try{canvas.setPointerCapture(e.pointerId)}catch(_){} state.sigDrawing=true; const {x,y}=getPos(e); state.sigCtx.beginPath(); state.sigCtx.moveTo(x,y); };
  const move = (e) => { if(!state.sigDrawing)return; e.preventDefault(); const {x,y}=getPos(e); state.sigCtx.lineTo(x,y); state.sigCtx.stroke(); state.sigHasStrokes=true; };
  const end = () => { if(state.sigDrawing){ state.sigDrawing=false; if(state.sigHasStrokes){ updateSignatureImage(); updateSignaturePosition(); } } };
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);
  const clearBtn = dom.options.querySelector('#sigClear');
  if(clearBtn) clearBtn.onclick = () => { state.sigCtx.save(); state.sigCtx.setTransform(1,0,0,1,0,0); state.sigCtx.clearRect(0,0,canvas.width,canvas.height); state.sigCtx.restore(); state.sigHasStrokes=false; updateSignatureImage(); };
  const saveBtn = dom.options.querySelector('#sigSave');
  if(saveBtn) saveBtn.onclick = () => {
    const url = getSignatureDataURL();
    if(!url){ msg('Dibuja una firma antes de guardarla.'); return; }
    const arr = getSavedSignatures();
    arr.push({dataURL:url, ts:Date.now()});
    while(arr.length>20)arr.shift();
    setSavedSignatures(arr);
    renderSavedSignatures();
  };
  const palette = [
    {n:'Negro',c:'#000000'},{n:'Blanco',c:'#ffffff'},{n:'Rojo',c:'#dc2626'},
    {n:'Verde',c:'#16a34a'},{n:'Azul',c:'#2563eb'},{n:'Amarillo',c:'#eab308'}
  ];
  const colorWrap = document.createElement('div');
  colorWrap.className = 'pen-colors';
  let adv = null;
  palette.forEach(p=>{
    const b = document.createElement('button');
    b.type='button'; b.className='pen-color'+(p.c.toLowerCase()===state._sigColor.toLowerCase()?' active':''); b.title=p.n; b.style.background=p.c;
    b.onclick = () => { state._sigColor=p.c; state.sigCtx.strokeStyle=state._sigColor; [...colorWrap.querySelectorAll('.pen-color')].forEach(x=>x.classList.remove('active')); b.classList.add('active'); if(adv)adv.value=p.c; };
    colorWrap.appendChild(b);
  });
  adv = document.createElement('input');
  adv.type='color'; adv.value=state._sigColor; adv.className='pen-color adv'; adv.style.padding='0'; adv.title='Color personalizado';
  adv.oninput = (e) => { state._sigColor=e.target.value; state.sigCtx.strokeStyle=state._sigColor; [...colorWrap.querySelectorAll('.pen-color')].forEach(x=>x.classList.remove('active')); adv.classList.add('active'); };
  colorWrap.appendChild(adv);
  canvas.parentNode.insertBefore(colorWrap, canvas.nextSibling);
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

/* ---------- Editor enriquecido ---------- */
export function wireEditor(){
  const editor = dom.options.querySelector('#editor');
  if(!editor)return;
  dom.options.querySelectorAll('[data-cmd]').forEach(btn=>{
    btn.onclick = (e) => { e.preventDefault(); editor.focus(); try{ document.execCommand(btn.dataset.cmd,false,null); }catch(_){} };
  });
  dom.options.querySelector('#tb-fg').oninput = (e) => { editor.focus(); try{ document.execCommand('foreColor',false,e.target.value); }catch(_){} };
  dom.options.querySelector('#tb-bg').oninput = (e) => { editor.focus(); try{ if(!document.execCommand('hiliteColor',false,e.target.value)) document.execCommand('backColor',false,e.target.value); }catch(_){} };
  dom.options.querySelector('#tb-font').onchange = (e) => { editor.focus(); try{document.execCommand('styleWithCSS',false,true)}catch(_){}; try{document.execCommand('fontName',false,e.target.value)}catch(_){}; };
  dom.options.querySelector('#tb-size').onchange = (e) => { editor.focus(); applyEditorFontSize(parseInt(e.target.value,10)||14); };
  const lh = dom.options.querySelector('#tb-lineheight');
  if(lh) lh.onchange = (e) => { const v = e.target.value; if(!v)return; editor.focus(); const val = parseFloat(v); const blocks = editor.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote'); blocks.forEach(el=>{ el.style.lineHeight = val; }); if(!blocks.length) editor.style.lineHeight = val; };
  dom.options.querySelector('#tb-clear').onclick = (e) => { e.preventDefault(); editor.focus(); try{document.execCommand('removeFormat',false,null)}catch(_){}; try{document.execCommand('formatBlock',false,'p')}catch(_){}; };
  const bulletBtn = dom.options.querySelector('#tb-bullet');
  if(bulletBtn) bulletBtn.onclick = (e) => { e.preventDefault(); openBulletMenu(bulletBtn); };
  const printBtn = dom.options.querySelector('#tb-print');
  if(printBtn) printBtn.onclick = () => { try{ printEditor(); }catch(e){ msg(e.message); } };
}
function openBulletMenu(anchorBtn){
  dom.options.querySelector('.bullet-menu')?.remove();
  const editor = dom.options.querySelector('#editor');
  if(!editor)return;
  editor.focus();
  const menu = document.createElement('div');
  menu.className = 'bullet-menu';
  const order = [
    {id:'disc',ch:'•'},{id:'circle',ch:'◦'},{id:'square',ch:'▪'},{id:'dash',ch:'–'},{id:'check',ch:'✓'},
    {id:'cross',ch:'✗'},{id:'star',ch:'★'},{id:'arrow',ch:'➤'},{id:'heart',ch:'♥'},{id:'none',ch:'∅'}
  ];
  let currentType = null;
  const ul = getCurrentUl(editor);
  if(ul){ const m = (ul.className||'').match(/bullet-([a-z]+)/); if(m)currentType = m[1]; }
  order.forEach(b=>{
    const btn = document.createElement('button');
    btn.type='button'; btn.textContent=b.ch; btn.title=b.id;
    if(currentType===b.id)btn.classList.add('on');
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => { applyBulletType(b.id); menu.remove(); };
    menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  const r = anchorBtn.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let top = r.bottom+4, left = r.left;
  if(top+mh>window.innerHeight-8) top = Math.max(8,r.top-mh-4);
  if(left+mw>window.innerWidth-8) left = Math.max(8,window.innerWidth-mw-8);
  menu.style.top = top+'px'; menu.style.left = left+'px';
  const closer = (e) => { if(!menu.contains(e.target)){ menu.remove(); document.removeEventListener('mousedown',closer,true); } };
  setTimeout(()=>document.addEventListener('mousedown',closer,true),50);
}
function getCurrentUl(editor){
  const sel = window.getSelection();
  if(!sel||!sel.anchorNode)return null;
  let n = sel.anchorNode;
  while(n&&n!==editor){
    if(n.nodeType===1&&n.tagName&&n.tagName.toLowerCase()==='ul')return n;
    n = n.parentNode;
  }
  return null;
}
function applyBulletType(type){
  const editor = dom.options.querySelector('#editor');
  if(!editor)return;
  editor.focus();
  let ul = getCurrentUl(editor);
  if(!ul){ try{document.execCommand('insertUnorderedList',false,null)}catch(_){}; ul = getCurrentUl(editor); }
  if(!ul)return;
  [...ul.classList].forEach(c=>{ if(c.startsWith('bullet-'))ul.classList.remove(c); });
  ul.classList.add('bullet-'+type);
}
function applyEditorFontSize(px){
  const editor = dom.options.querySelector('#editor');
  if(!editor)return;
  editor.focus();
  try{ document.execCommand('fontSize',false,'7'); }catch(_){}
  editor.querySelectorAll('font[size="7"]').forEach(el=>{ el.removeAttribute('size'); el.style.fontSize = px+'px'; });
}
function printEditor(){
  const editor = dom.options.querySelector('#editor');
  if(!editor)throw new Error('El editor no está disponible.');
  if(!editor.textContent.trim())throw new Error('El editor está vacío.');
  const sheetSel = dom.options.querySelector('#txt-size')?.value||'Carta';
  const orient = dom.options.querySelector('#txt-orient')?.value||'Vertical';
  const customW = parseFloat(dom.options.querySelector('#txt-w')?.value)||21.59;
  const customH = parseFloat(dom.options.querySelector('#txt-h')?.value)||27.94;
  let marginCm = parseFloat(dom.options.querySelector('#txt-margin')?.value);
  if(isNaN(marginCm))marginCm = 0.6;
  const marginMm = (marginCm*10).toFixed(2);
  let sizeCss;
  if(sheetSel==='Personalizado'){
    let pw = customW, ph = customH;
    if(orient==='Horizontal'&&ph>pw)[pw,ph]=[ph,pw];
    if(orient==='Vertical'&&pw>ph)[pw,ph]=[ph,pw];
    sizeCss = pw.toFixed(2)+'cm '+ph.toFixed(2)+'cm';
  }else{
    const s = SHEET_SIZES[sheetSel];
    if(s){
      let pw = s.w, ph = s.h;
      if(orient==='Horizontal'&&ph>pw)[pw,ph]=[ph,pw];
      if(orient==='Vertical'&&pw>ph)[pw,ph]=[ph,pw];
      sizeCss = pw.toFixed(2)+'cm '+ph.toFixed(2)+'cm';
    }else sizeCss = 'Letter '+(orient==='Horizontal'?'landscape':'portrait');
  }
  const html = editor.innerHTML;
  const w = window.open('','_blank');
  if(!w)throw new Error('El navegador bloqueó la ventana de impresión.');
  w.document.open();
  w.document.write(
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Documento</title><style>'+
    '@page{size:'+sizeCss+';margin:'+marginMm+'mm}'+
    'html,body{margin:0;padding:0}'+
    'body{font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#000;line-height:1.5}'+
    'ul,ol{padding-left:24px}'+
    'blockquote{border-left:3px solid #ccc;padding-left:10px;color:#555}'+
    'pre{white-space:pre-wrap;font-family:Consolas,monospace}'+
    'ul.bullet-disc{list-style-type:disc}'+
    'ul.bullet-circle{list-style-type:circle}'+
    'ul.bullet-square{list-style-type:square}'+
    'ul.bullet-dash{list-style-type:"- "}'+
    'ul.bullet-check{list-style-type:"\u2713 "}'+
    'ul.bullet-cross{list-style-type:"\u2717 "}'+
    'ul.bullet-star{list-style-type:"\u2605 "}'+
    'ul.bullet-arrow{list-style-type:"\u27A4 "}'+
    'ul.bullet-heart{list-style-type:"\u2665 "}'+
    'ul.bullet-none{list-style-type:none}'+
    '</style></head><body>'+html+'</body></html>'
  );
  w.document.close();
  w.focus();
  setTimeout(()=>{ try{w.print()}catch(e){} },500);
}

/* ---------- Página Web a PDF ---------- */
export function makeWebPdf(){
  const urlInput = dom.options.querySelector('#web-url');
  let url = (urlInput?.value||'').trim();
  if(!url)throw new Error('Escribe una URL.');
  if(!/^https?:\/\//i.test(url)) url = 'https://'+url;
  let parsed;
  try{ parsed = new URL(url); }catch(e){ throw new Error('URL no válida.'); }
  const screenSel = dom.options.querySelector('#web-screen').value;
  let sw,sh;
  if(screenSel==='custom'){ sw = parseInt(dom.options.querySelector('#web-sw').value,10)||1366; sh = parseInt(dom.options.querySelector('#web-sh').value,10)||768; }
  else { [sw,sh] = screenSel.split('x').map(Number); }
  sw = Math.max(240,Math.min(3840,sw));
  sh = Math.max(240,Math.min(2160,sh));
  const pageSel = dom.options.querySelector('#web-page').value;
  const orient = dom.options.querySelector('#web-orient').value;
  let pageCss;
  if(pageSel==='Personalizado'){
    let pw = parseFloat(dom.options.querySelector('#web-pw').value)||21.59, ph = parseFloat(dom.options.querySelector('#web-ph').value)||27.94;
    if(orient==='Horizontal'&&ph>pw)[pw,ph]=[ph,pw];
    if(orient==='Vertical'&&pw>ph)[pw,ph]=[ph,pw];
    pageCss = pw.toFixed(2)+'cm '+ph.toFixed(2)+'cm';
  }else{
    const s = SHEET_SIZES[pageSel];
    if(s){
      let pw = s.w, ph = s.h;
      if(orient==='Horizontal'&&ph>pw)[pw,ph]=[ph,pw];
      if(orient==='Vertical'&&pw>ph)[pw,ph]=[ph,pw];
      pageCss = pw.toFixed(2)+'cm '+ph.toFixed(2)+'cm';
    }else pageCss = 'Letter '+(orient==='Horizontal'?'landscape':'portrait');
  }
  let marginCm = parseFloat(dom.options.querySelector('#web-margin').value);
  if(isNaN(marginCm))marginCm = 0.6;
  const marginMm = (marginCm*10).toFixed(2);
  const features = 'width='+sw+',height='+sh+',menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes';
  const popup = window.open('','_blank',features);
  if(!popup)throw new Error('El navegador bloqueó la ventana emergente.');
  const escUrl = url.replace(/"/g,'&quot;').replace(/&/g,'&amp;');
  const escHost = esc(parsed.hostname);
  popup.document.open();
  popup.document.write(
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>'+escHost+'</title><style>'+
    '@page{size:'+pageCss+';margin:'+marginMm+'mm}'+
    'html,body{margin:0;padding:0;height:100%;background:#fff;font-family:system-ui,sans-serif}'+
    '.banner{background:#2563eb;color:#fff;padding:8px 12px;font-size:12.5px;display:flex;align-items:center;justify-content:space-between;gap:10px;position:sticky;top:0;z-index:2}'+
    '.banner button{border:0;background:#fff;color:#2563eb;padding:6px 12px;border-radius:8px;font-weight:700;cursor:pointer;font-size:12.5px}'+
    '.wrap{height:calc(100% - 38px)}'+
    'iframe{width:100%;height:100%;border:0;display:block;background:#fff}'+
    '@media print{.banner{display:none!important}.wrap{height:100%}}'+
    '</style></head><body>'+
    '<div class="banner"><span>Cargando <b>'+escHost+'</b>… Pulsa <b>Imprimir</b> y elige <b>Guardar como PDF</b>.</span>'+
    '<button onclick="window.print()">Imprimir</button></div>'+
    '<div class="wrap"><iframe id="frame" src="'+escUrl+'" referrerpolicy="no-referrer"></iframe></div>'+
    '<scr'+'ipt>(function(){var f=document.getElementById("frame"),done=false;function go(){if(done)return;done=true;setTimeout(function(){try{window.print()}catch(e){}},400)}f.addEventListener("load",go);setTimeout(go,9000)})();<\/scr'+'ipt>'+
    '</body></html>'
  );
  popup.document.close();
  popup.focus();
}