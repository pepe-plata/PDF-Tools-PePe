/* ==========================================================================
   tools-edit.js — Reordenar, Borrar, Rotar, Dividir, Extraer, Imagen↔PDF,
                    Combinar, TXT/HTML, listas de archivos
   ========================================================================== */
import {
  CM, SHEET_SIZES, state, dom,
  msg, esc, fileSize, base, parseRange, busy, dl, fileKind, KIND_ICON,
  safeText, resolveSheetSizeCM, imageToCanvas, appendTextPages,
  renderThumbOnPage, isPdf
} from './app.js';

/* ---------- Acción genérica ---------- */
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
  state.thumbUrls.forEach(u=>{try{URL.revokeObjectURL(u)}catch(_){}});
  state.thumbUrls = [];
  const reorder = (state.current==='merge'||state.current==='mixpdf');
  const multi   = (state.current==='merge'||state.current==='mixpdf'||state.current==='imagepdf');
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

/* ---------- Extraer páginas / PDF→Imagen ---------- */
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

/* ---------- Imagen → PDF ---------- */
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

      let dw,dh;
      if(imgWcm&&imgHcm){
        const boxW = imgWcm*CM, boxH = imgHcm*CM;
        if(keepAspect){
          const srcRatio = iw / ih;
          const boxRatio = boxW / boxH;
          if(srcRatio > boxRatio){ dw = boxW; dh = boxW / srcRatio; }
          else{ dh = boxH; dw = boxH * srcRatio; }
        }else{
          dw = boxW; dh = boxH;
        }
      }else{
        const availW = Math.max(1,pgW-marginPt*2);
        const availH = Math.max(1,pgH-marginPt*2);
        const k = Math.min(availW/canvas.width, availH/canvas.height);
        dw = canvas.width*k;
        dh = canvas.height*k;
      }

      let x;
      if(posH==='custom') x = posXcm*CM;
      else if(posH==='center') x = (pgW-dw)/2;
      else if(posH==='right') x = pgW-marginPt-dw;
      else x = marginPt;

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
      '</div>'+
      '<div class="section">Vista previa</div>'+
      '<div class="thumbs" id="divPreview"></div>';
    const grid = dom.preview.querySelector('#divPreview');
    for(let n=1;n<=state.pdfDoc.numPages;n++){
      const d = document.createElement('div');
      d.className = 'thumb';
      d.innerHTML = '<canvas></canvas><small>Página '+n+'</small>';
      grid.appendChild(d);
      renderThumbOnPage(state.pdfDoc, n, d.querySelector('canvas'));
    }
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
      const rows = [...dom.options.querySelectorAll('#div-ranges-table tbody tr')];
      if(!rows.length) throw new Error('Añade al menos un rango.');
      let counter = 1;
      for(const tr of rows){
        const nameInp = tr.querySelector('.rng-name');
        const fromInp = tr.querySelector('.rng-from');
        const toInp   = tr.querySelector('.rng-to');
        const name = (nameInp.value || '').trim() || ('parte'+(counter++));
        let from = parseInt(fromInp.value, 10);
        let to   = parseInt(toInp.value, 10);
        if(isNaN(from) || from < 1) from = 1;
        if(isNaN(to) || to < from) to = total;
        from = Math.min(from, total);
        to = Math.min(to, total);
        const pages = [];
        for(let n = from; n <= to; n++) pages.push(n);
        if(pages.length) tasks.push({name, pages});
      }
      if(!tasks.length) throw new Error('Ningún rango válido.');
    }else{
      const npp = Math.max(1, parseInt(dom.options.querySelector('#div-npp').value,10)||1);
      let idx = 1;
      for(let start = 1; start <= total; start += npp){
        const end = Math.min(total, start + npp - 1);
        const pages = [];
        for(let n = start; n <= end; n++) pages.push(n);
        tasks.push({name:'parte'+idx, pages});
        idx++;
      }
    }

    for(let t = 0; t < tasks.length; t++){
      p.check();
      const task = tasks[t];
      p.set(20 + t/tasks.length*70, 'Generando '+task.name+' ('+task.pages.length+' pág)…');
      const out = await window.PDFLib.PDFDocument.create();
      const copied = await out.copyPages(src, task.pages.map(n => n-1));
      copied.forEach(pg => out.addPage(pg));
      const bytes = await out.save();
      zip.file(task.name + '.pdf', bytes);
    }

    p.set(95, 'Comprimiendo ZIP…');
    const blob = await zip.generateAsync({type:'blob'});
    await dl(await blob.arrayBuffer(), base(state.loadedFiles[0].name)+'_dividido.zip', 'application/zip');
    p.done('PDF dividido en '+tasks.length+' archivo(s).');
  }catch(e){ if(e.message==='__CANCEL__')p.done('Operación cancelada.'); else{ p.done('Error'); throw e; } }
}