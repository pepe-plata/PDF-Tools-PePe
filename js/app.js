/* ==========================================================================
   app.js — Navegación, estado, utilidades y render de opciones
   ========================================================================== */
import * as Engines from './engines.js';
import * as Tools from './tools.js';

/* ---------- Constantes ---------- */
export const CM = 28.3464567;
export const MM = 2.83464567;

export const SHEET_SIZES = {
  'MediaCarta':  {w:21.59, h:13.97, label:'Media Carta 21.59 × 13.97 cm (8.5" × 5.5")'},
  'Carta':       {w:21.59, h:27.94, label:'Carta (Letter) 21.59 × 27.94 cm (8.5" × 11")'},
  'Oficio':      {w:21.59, h:35.56, label:'Oficio / Legal 21.59 × 35.56 cm (8.5" × 14")'},
  'A4':          {w:21,    h:29.7,  label:'A4 21 × 29.7 cm (8.27" × 11.69")'},
  'DobleCarta':  {w:43.18, h:27.94, label:'Doble Carta 43.18 × 27.94 cm (17" × 11")'},
  'Tabloide':    {w:27.94, h:43.18, label:'Tabloide 27.94 × 43.18 cm (11" × 17")'},
  'FotoInfantil':{w:2.5,   h:3.0,   label:'Foto infantil 2.5 × 3.0 cm'},
  'FotoPostal':  {w:10.2,  h:15.2,  label:'Foto Postal 10.2 × 15.2 cm (4" × 6")'},
  'Foto5x7':     {w:12.7,  h:17.8,  label:'12.7 × 17.8 cm (5" × 7")'},
  'Foto6x8':     {w:15.24, h:20.32, label:'15.24 × 20.32 cm (6" × 8")'},
  'Foto8x10':    {w:20.32, h:25.4,  label:'20.32 × 25.4 cm (8" × 10")'}
};

export function sheetOptionsHTML(selected='Carta'){
  let html = '<optgroup label="── Tamaños de Hoja ──">';
  ['MediaCarta','Carta','Oficio','A4','DobleCarta','Tabloide'].forEach(k=>{
    const s = SHEET_SIZES[k];
    html += '<option value="'+k+'"'+(k===selected?' selected':'')+'>'+s.label+'</option>';
  });
  html += '</optgroup><optgroup label="── Tamaños de Fotografía ──">';
  ['FotoInfantil','FotoPostal','Foto5x7','Foto6x8','Foto8x10'].forEach(k=>{
    const s = SHEET_SIZES[k];
    html += '<option value="'+k+'"'+(k===selected?' selected':'')+'>'+s.label+'</option>';
  });
  html += '</optgroup><option value="Personalizado">Personalizado…</option>';
  return html;
}

export const toolsMeta = {
  viewer:     {title:'Visor PDF',desc:'Abre un PDF y navega, haz zoom y desplázate.'},
  extract:    {title:'Extraer páginas',desc:'Selecciona páginas visualmente o mediante rangos.'},
  merge:      {title:'Unir PDF',desc:'Selecciona varios PDF, cambia el orden y crea un solo archivo.'},
  reorder:    {title:'Reordenar páginas',desc:'Cambia el orden de las páginas.'},
  deletepage: {title:'Borrar páginas',desc:'Elimina una o varias páginas del PDF.'},
  rotate:     {title:'Rotar páginas',desc:'Rota 90°, 180° o 270° una o varias páginas.'},
  divide:     {title:'Dividir PDF',desc:'Separa el PDF por rangos o por N páginas por archivo.'},
  image:      {title:'PDF → Imagen',desc:'Exporta páginas a JPG o PNG con DPI configurable.'},
  imagepdf:   {title:'Imagen → PDF',desc:'Convierte imágenes a PDF con posición, tamaño y hoja.'},
  mixpdf:     {title:'Combinar en PDF',desc:'Mezcla imágenes, TXT y PDF en un único PDF.'},
  extractimg: {title:'Extraer Imágenes',desc:'Extrae las imágenes incrustadas en un PDF.'},
  signature:  {title:'Firmar PDF',desc:'Dibuja o carga tu firma y colócala en el PDF.'},
  fill:       {title:'Llenar PDF',desc:'Inserta uno o varios textos sobre el PDF.'},
  watermark:  {title:'Marca de agua',desc:'Texto, imagen o PDF superpuesto.'},
  textedit:   {title:'Texto a PDF',desc:'Editor con formato y exportación.'},
  web:        {title:'Página Web a PDF',desc:'Convierte una URL a PDF.'},
  txt:        {title:'TXT → PDF',desc:'Convierte texto plano a PDF.'},
  html:       {title:'HTML → PDF',desc:'Abre vista de impresión.'}
};

/* ---------- Estado global ---------- */
export const state = {
  current: '',
  pdfDoc: null,
  selected: new Set(),
  loadedFiles: [],
  cancelled: false,
  thumbUrls: [],
  pageCounts: new WeakMap(),
  // Firma
  sigCtx: null, sigDrawing: false, sigHasStrokes: false,
  _sigPageCanvas: null, _sigPageNum: null, _sigScale: 1,
  _sigColor: '#0b1220', _sigAngle: 0,
  _sigXcm: 10, _sigYcm: 3, _sigWcm: 5, _sigHcm: 2.5,
  _sigTool: 'pencil', _sigStroke: '#0b1220', _sigFill: 'transparent', _sigStrokeWidth: 2.4,
  // Reordenar / borrar / rotar
  _reorderOrder: [], _deleteSet: new Set(), _rotSet: new Set(), _rotAngle: 90,
  // Marca de agua
  _wmType: 'text', _wmImageBytes: null, _wmPdfBytes: null, _wmPdfPageNum: 1,
  _wmPageCanvas: null, _wmPageNum: null, _wmScale: 1,
  _wmGeom: null,
  // Llenar
  _fillPageCanvas: null, _fillPageNum: null, _fillScale: 1,
  _fillItems: [], _fillSelectedIdx: -1,
  // Visor
  _viewerScale: 1.0, _viewerPage: 1, _viewerPanMode: false,
  _viewerPageWrappers: []
};

/* ---------- Referencias DOM ---------- */
export const dom = {
  home: document.querySelector('#home'),
  tool: document.querySelector('#tool'),
  title: document.querySelector('#toolTitle'),
  desc: document.querySelector('#toolDesc'),
  file: document.querySelector('#file'),
  pick: document.querySelector('#pick'),
  drop: document.querySelector('#drop'),
  options: document.querySelector('#options'),
  preview: document.querySelector('#preview'),
  navBtn: document.querySelector('#navBtn'),
  netBadge: document.querySelector('#net'),
  engine: document.querySelector('#engine')
};

/* ---------- Red ---------- */
export function updateNetwork(){
  const on = navigator.onLine;
  dom.netBadge.textContent = on ? '● En línea' : '● Sin conexión';
  dom.netBadge.style.color = on ? 'var(--muted)' : 'var(--danger)';
}

/* ---------- Utilidades generales ---------- */
export function isPdf(f){return /pdf/i.test(f.type)||f.name.toLowerCase().endsWith('.pdf')}
export function msg(t){dom.preview.innerHTML='<div class="panel" style="margin-top:12px;color:var(--danger)">'+esc(t)+'</div>'}
export function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
export function fileSize(n){if(n<1024)return n+' B';if(n<1048576)return(n/1024).toFixed(1)+' KB';if(n<1073741824)return(n/1048576).toFixed(1)+' MB';return(n/1073741824).toFixed(1)+' GB'}
export function base(n){return n.replace(/\.[^.]+$/,'')}

export function parseRange(s,max){
  if(!s||!s.trim())return[];
  const out = new Set();
  for(const part of s.split(',')){
    const p = part.trim();
    if(/^\d+$/.test(p)){const n=+p;if(n>=1&&n<=max)out.add(n)}
    else if(/^(\d+)-(\d+)$/.test(p)){let[a,b]=p.split('-').map(Number);if(a>b)[a,b]=[b,a];for(let n=Math.max(1,a);n<=Math.min(max,b);n++)out.add(n)}
  }
  return [...out].sort((a,b)=>a-b);
}

export function busy(t='Procesando…'){
  state.cancelled = false;
  const d = document.createElement('div');
  d.className = 'progressWrap';
  d.innerHTML = '<div class="progressBar"><i></i></div><div class="progressLine"><span class="statusText">'+esc(t)+'</span><button class="danger mini" type="button">Cancelar</button></div>';
  dom.preview.appendChild(d);
  const btn = d.querySelector('button');
  btn.onclick = () => { state.cancelled = true; btn.disabled = true; d.querySelector('.statusText').textContent = 'Cancelando…'; };
  return {
    el: d,
    set(v,t){d.querySelector('i').style.width = Math.max(0,Math.min(100,v))+'%'; if(t)d.querySelector('.statusText').textContent=t;},
    done(t){d.querySelector('i').style.width='100%'; d.querySelector('.statusText').textContent=t; btn.remove();},
    check(){if(state.cancelled)throw new Error('__CANCEL__');}
  };
}

export async function dl(bytes, name, type='application/pdf'){
  const blob = new Blob([bytes],{type});
  const cleanName = String(name||'archivo').trim()||'archivo';
  if(typeof window.showSaveFilePicker === 'function'){
    try{
      const ext = (cleanName.split('.').pop()||'pdf').toLowerCase();
      const acceptMap = {
        pdf:{'application/pdf':['.pdf']},
        png:{'image/png':['.png']},
        jpg:{'image/jpeg':['.jpg','.jpeg']},
        jpeg:{'image/jpeg':['.jpg','.jpeg']},
        zip:{'application/zip':['.zip']}
      };
      const handle = await window.showSaveFilePicker({
        suggestedName: cleanName,
        types: acceptMap[ext] ? [{description:ext.toUpperCase(),accept:acceptMap[ext]}] : undefined
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    }catch(e){ if(e&&e.name==='AbortError')return false; }
  }
  let filename = cleanName;
  try{
    const input = window.prompt('Nombre del archivo:',cleanName);
    if(input===null)return false;
    const cleaned = String(input).trim().replace(/[\\/:*?"<>|\u0000-\u001F]/g,'_');
    if(cleaned){
      filename = cleaned;
      if(!/\.[a-zA-Z0-9]{2,5}$/.test(filename)){
        const ext2 = (cleanName.split('.').pop()||'pdf');
        filename += '.'+ext2;
      }
    }
  }catch(e){}
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1500);
  return true;
}

export function fileKind(f){
  const n = (f?.name||'').toLowerCase(), t = (f?.type||'').toLowerCase();
  if(t==='application/pdf'||n.endsWith('.pdf'))return 'pdf';
  if(t.startsWith('image/')||/\.(png|jpe?g|webp|gif|bmp|avif)$/.test(n))return 'image';
  if(t.startsWith('text/')||/\.(txt|md|csv|log)$/.test(n))return 'text';
  return 'other';
}
export const KIND_ICON = {pdf:'📄',image:'🖼️',text:'📝',other:'📎'};

export function safeText(s){
  return String(s)
    .replace(/[\u2018\u2019\u201A\u201B]/g,"'")
    .replace(/[\u201C\u201D\u201E\u201F]/g,'"')
    .replace(/[\u2013\u2014]/g,'-')
    .replace(/\u2026/g,'...')
    .replace(/\u00A0/g,' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'')
    .replace(/[^\u0000-\u00FF]/g,'?');
}

export function resolveSheetSizeCM(name, orient, customWcm, customHcm){
  let w,h;
  if(name==='Personalizado'){w=customWcm||21.59;h=customHcm||27.94}
  else{const s = SHEET_SIZES[name]||SHEET_SIZES['Carta'];w=s.w;h=s.h}
  if(orient==='Horizontal'&&h>w)[w,h]=[h,w];
  if(orient==='Vertical'&&w>h)[w,h]=[h,w];
  return [w*CM, h*CM];
}

export async function imageToCanvas(file, maxPixels=24000000){
  let src=null, objUrl=null;
  try{
    if(typeof createImageBitmap==='function'){try{src=await createImageBitmap(file)}catch(_){src=null}}
    if(!src){
      objUrl = URL.createObjectURL(file);
      src = await new Promise((res,rej)=>{
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('No se pudo leer la imagen: '+file.name));
        im.src = objUrl;
      });
    }
    const w = src.width||src.naturalWidth||0, h = src.height||src.naturalHeight||0;
    if(!w||!h)throw new Error('Imagen no válida: '+file.name);
    let k = 1; if(w*h > maxPixels) k = Math.sqrt(maxPixels/(w*h));
    const c = document.createElement('canvas');
    c.width = Math.max(1,Math.round(w*k));
    c.height = Math.max(1,Math.round(h*k));
    c.getContext('2d').drawImage(src,0,0,c.width,c.height);
    try{src.close?.()}catch(_){}
    return {canvas:c, width:w, height:h};
  }finally{ if(objUrl)URL.revokeObjectURL(objUrl); }
}

export function appendTextPages(out, font, text, pageW, pageH, margin, size=11, lineH=15){
  const maxW = Math.max(20, pageW-margin*2);
  const lines = [];
  for(const raw of String(text).replace(/\r\n?/g,'\n').split('\n')){
    if(raw===''){lines.push('');continue}
    let line = '';
    for(const chunk of raw.split(/(\s+)/)){
      const test = line+chunk;
      if(font.widthOfTextAtSize(safeText(test)||' ',size)<=maxW) line=test;
      else{if(line)lines.push(line);line=chunk.replace(/^\s+/,'')}
    }
    lines.push(line);
  }
  let page = out.addPage([pageW,pageH]);
  let y = pageH-margin-size;
  for(const line of lines){
    if(y<margin){page=out.addPage([pageW,pageH]);y=pageH-margin-size}
    if(line)page.drawText(safeText(line),{x:margin,y,size,font});
    y -= lineH;
  }
  return out;
}

export async function renderThumbOnPage(doc, pageNum, canvas){
  try{
    const p = await doc.getPage(pageNum);
    const v = p.getViewport({scale:.45});
    canvas.width = v.width;
    canvas.height = v.height;
    await p.render({canvasContext:canvas.getContext('2d'),viewport:v}).promise;
  }catch(e){}
}

export function hexToRgb(hex){
  const m = String(hex).replace('#','');
  const n = m.length===3
    ? [parseInt(m[0]+m[0],16),parseInt(m[1]+m[1],16),parseInt(m[2]+m[2],16)]
    : [parseInt(m.slice(0,2),16),parseInt(m.slice(2,4),16),parseInt(m.slice(4,6),16)];
  return window.PDFLib.rgb(n[0]/255,n[1]/255,n[2]/255);
}

/* ---------- Navegación ---------- */
export function goHome(){
  dom.tool.classList.add('hidden');
  dom.home.classList.remove('hidden');
  reset();
  updateNavBtn();
}
export function updateNavBtn(){
  const onTool = !dom.tool.classList.contains('hidden');
  if(onTool){
    dom.navBtn.innerHTML = '<img src="./icons/return.png" alt="Volver" onerror="this.onerror=null;this.replaceWith(document.createTextNode(\'←\'))">';
    dom.navBtn.title = 'Volver';
    dom.navBtn.disabled = false;
  }else{
    dom.navBtn.textContent = '🏠';
    dom.navBtn.title = 'Inicio';
    dom.navBtn.disabled = true;
  }
}
export function reset(){
  revokeThumbs();
  dom.file.value = '';
  dom.preview.innerHTML = '';
  dom.options.innerHTML = '';
  state.loadedFiles = [];
  state.selected.clear();
  state.pdfDoc = null;
  state.sigCtx = null; state.sigDrawing = false; state.sigHasStrokes = false;
  state._sigPageCanvas = null; state._sigPageNum = null; state._sigScale = 1; state._sigAngle = 0;
  state._sigColor = '#0b1220'; state._sigXcm = 10; state._sigYcm = 3; state._sigWcm = 5; state._sigHcm = 2.5;
  state._sigTool = 'pencil'; state._sigStroke = '#0b1220'; state._sigFill = 'transparent'; state._sigStrokeWidth = 2.4;
  state._reorderOrder = []; state._deleteSet = new Set(); state._rotSet = new Set();
  state._wmType = 'text'; state._wmImageBytes = null; state._wmPdfBytes = null; state._wmPdfPageNum = 1;
  state._wmPageCanvas = null; state._wmPageNum = null; state._wmScale = 1;
  state._wmGeom = null;
  state._fillPageCanvas = null; state._fillPageNum = null; state._fillScale = 1;
  state._fillItems = []; state._fillSelectedIdx = -1;
  state._viewerScale = 1.0; state._viewerPage = 1; state._viewerPanMode = false;
  state._viewerPageWrappers = [];
}
export function revokeThumbs(){
  state.thumbUrls.forEach(u=>{try{URL.revokeObjectURL(u)}catch(_){}});
  state.thumbUrls = [];
}

/* ---------- Render de opciones ---------- */
export function renderOptions(){
  const defaultSheet = sheetOptionsHTML('Carta');

  if(state.current==='viewer'){
    dom.options.innerHTML = '<p class="note" style="margin-top:8px">Selecciona un PDF y podrás navegar página a página, cambiar el zoom y desplazarte por el documento.</p>';
  }

  if(state.current==='extract'){
    dom.options.innerHTML = '<div class="row"><label>Rango de páginas<input id="range" class="field" placeholder="Ej.: 1,3,5-8"></label><div><span style="font-size:12px;color:var(--muted)">Selección visual</span><div class="actions"><button class="secondary" id="all" type="button">Todas</button><button class="secondary" id="none" type="button">Ninguna</button></div></div></div>';
  }

  if(state.current==='extractimg'){
    dom.options.innerHTML = '<p class="note" style="margin-top:8px">Pulsa las miniaturas para seleccionar las páginas de las que quieres extraer las imágenes.</p><div class="actions"><button class="secondary" id="all" type="button">Todas</button><button class="secondary" id="none" type="button">Ninguna</button></div>';
  }

  if(state.current==='reorder'){
    dom.options.innerHTML = '<p class="note" style="margin-top:8px">Arrastra una miniatura sobre otra o usa las flechas ← →.</p><div class="actions"><button class="secondary" type="button" id="reo-reset">Restablecer orden</button><button class="secondary" type="button" id="reo-reverse">Invertir</button></div>';
  }

  if(state.current==='deletepage'){
    dom.options.innerHTML = '<p class="note" style="margin-top:8px">Pulsa las miniaturas para marcar las páginas a eliminar.</p><div class="actions"><button class="secondary" type="button" id="del-all">Marcar todas</button><button class="secondary" type="button" id="del-none">Desmarcar todas</button><button class="danger" type="button" id="del-apply">Borrar seleccionadas</button></div>';
  }

  if(state.current==='rotate'){
    dom.options.innerHTML =
      '<div class="row">'+
        '<label>Rotar<input id="rot-angle" class="field" type="number" min="-360" max="360" step="90" value="90"></label>'+
        '<label>Sentido<select id="rot-sign" class="field"><option value="1">Horario (→)</option><option value="-1">Antihorario (←)</option></select></label>'+
      '</div>'+
      '<p class="note" style="margin-top:8px">Marca las páginas a rotar. Si no marcas ninguna, se rotan todas.</p>'+
      '<div class="actions"><button class="secondary" type="button" id="rot-all">Marcar todas</button><button class="secondary" type="button" id="rot-none">Desmarcar</button><button class="primary" type="button" id="rot-apply">Aplicar rotación</button></div>';
    dom.options.querySelector('#rot-all').onclick = () => { state._rotSet = new Set(Array.from({length:state.pdfDoc.numPages},(_,i)=>i+1)); Tools.renderRotateGrid(); };
    dom.options.querySelector('#rot-none').onclick = () => { state._rotSet.clear(); Tools.renderRotateGrid(); };
    dom.options.querySelector('#rot-apply').onclick = () => Tools.applyRotate().catch(e=>{ if(e.message!=='__CANCEL__')msg(e.message); });
  }

  if(state.current==='divide'){
    dom.options.innerHTML =
      '<div class="row">'+
        '<label>Modo<select id="div-mode" class="field">'+
          '<option value="ranges">Rangos personalizados</option>'+
          '<option value="npp">N páginas por archivo</option>'+
        '</select></label>'+
        '<label id="div-nwrap" style="display:none">Páginas por archivo<input id="div-npp" class="field" type="number" min="1" step="1" value="1"></label>'+
      '</div>'+
      '<div id="div-ranges-wrap" style="margin-top:10px">'+
        '<div class="section" style="margin:0 0 6px">Rangos</div>'+
        '<table class="ranges-table" id="div-ranges-table">'+
          '<thead><tr><th style="width:40%">Nombre</th><th style="width:24%">Desde</th><th style="width:24%">Hasta</th><th></th></tr></thead>'+
          '<tbody></tbody>'+
        '</table>'+
        '<div class="ranges-toolbar">'+
          '<button class="secondary" type="button" id="div-add-range">+ Agregar rango</button>'+
          '<button class="danger" type="button" id="div-clear-ranges">Borrar todo</button>'+
        '</div>'+
      '</div>'+
      '<p class="note" style="margin-top:10px">Se generará un ZIP con un PDF por cada rango. Los rangos sin nombre se numeran automáticamente.</p>'+
      '<div class="actions"><button class="primary" type="button" id="div-apply">Dividir y descargar ZIP</button></div>';

    const mode = dom.options.querySelector('#div-mode');
    mode.onchange = () => {
      const isRanges = mode.value === 'ranges';
      dom.options.querySelector('#div-ranges-wrap').style.display = isRanges?'block':'none';
      dom.options.querySelector('#div-nwrap').style.display = isRanges?'none':'block';
    };

    const tbody = dom.options.querySelector('#div-ranges-table tbody');
    function addRangeRow(name, from, to){
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input type="text" class="rng-name" placeholder="parte" value="'+esc(name||'')+'"></td>'+
        '<td><input type="number" class="rng-from" min="1" step="1" value="'+(from||1)+'"></td>'+
        '<td><input type="number" class="rng-to" min="1" step="1" value="'+(to||'')+'"></td>'+
        '<td class="actions-cell"><button type="button" title="Eliminar rango">✕</button></td>';
      tr.querySelector('.actions-cell button').onclick = () => { tr.remove(); };
      tbody.appendChild(tr);
    }
    addRangeRow('parte1', 1, '');

    dom.options.querySelector('#div-add-range').onclick = () => {
      const n = tbody.children.length + 1;
      addRangeRow('parte'+n, 1, '');
    };
    dom.options.querySelector('#div-clear-ranges').onclick = () => {
      tbody.innerHTML = '';
      addRangeRow('parte1', 1, '');
    };

    dom.options.querySelector('#div-apply').onclick = () => Tools.applyDivide().catch(e=>{ if(e.message!=='__CANCEL__')msg(e.message); });
  }

  if(state.current==='image'){
    dom.options.innerHTML = '<div class="row"><label>Formato<select id="fmt" class="field"><option>JPG</option><option>PNG</option></select></label><label>Resolución<select id="dpi" class="field"><option>72</option><option>96</option><option>150</option><option>200</option><option selected>300</option><option>600</option></select></label></div>';
  }

  if(state.current==='imagepdf'){
    dom.options.innerHTML =
      '<div class="row">'+
        '<label>Tamaño de hoja<select id="size" class="field">'+defaultSheet+'</select></label>'+
        '<label>Orientación<select id="orient" class="field"><option>Vertical</option><option>Horizontal</option></select></label>'+
      '</div>'+
      '<div id="customSheetSize" class="row" style="display:none">'+
        '<label>Ancho hoja (cm)<input id="sheet-w" class="field" type="number" min="1" step="0.1" value="21.59"></label>'+
        '<label>Alto hoja (cm)<input id="sheet-h" class="field" type="number" min="1" step="0.1" value="27.94"></label>'+
      '</div>'+
      '<label style="display:block;margin-top:10px;font-size:12px;color:var(--muted)">Tamaño de la imagen<select id="imgsize" class="field">'+
        '<option value="auto">Ajustar a la hoja</option>'+
        '<option value="Carta">Carta (21.59 × 27.94 cm)</option>'+
        '<option value="Oficio">Oficio (21.59 × 35.56 cm)</option>'+
        '<option value="A4">A4 (21 × 29.7 cm)</option>'+
        '<option value="FotoInfantil">Foto Infantil (2.5 × 3 cm)</option>'+
        '<option value="FotoPostal">Foto Postal (10.2 × 15.2 cm)</option>'+
        '<option value="Foto5x7">12.7 × 17.8 cm (5"×7")</option>'+
        '<option value="Foto6x8">15.24 × 20.32 cm (6"×8")</option>'+
        '<option value="Foto8x10">20.32 × 25.4 cm (8"×10")</option>'+
        '<option value="custom">Personalizado (centímetros)</option>'+
      '</select></label>'+
      '<div id="customImgSize" class="row" style="display:none">'+
        '<label>Ancho imagen (cm)<input id="imgw" class="field" type="number" min="0.1" step="0.1" value="10"></label>'+
        '<label>Alto imagen (cm)<input id="imgh" class="field" type="number" min="0.1" step="0.1" value="15"></label>'+
      '</div>'+
      '<div class="checkbox-row">'+
        '<input type="checkbox" id="keep-aspect" checked>'+
        '<label for="keep-aspect">Conservar Relación de Aspecto</label>'+
      '</div>'+
      '<div class="section" style="margin-top:14px">Posición de la imagen en la hoja</div>'+
      '<div class="row">'+
        '<label>Vertical<select id="pos-v" class="field"><option value="top">Arriba</option><option value="center" selected>Centro</option><option value="bottom">Abajo</option><option value="custom">Personalizado</option></select></label>'+
        '<label>Horizontal<select id="pos-h" class="field"><option value="left">Izquierda</option><option value="center" selected>Centro</option><option value="right">Derecha</option><option value="custom">Personalizado</option></select></label>'+
      '</div>'+
      '<div id="customPos" class="row" style="display:none">'+
        '<label>X desde borde izq. (cm)<input id="pos-x" class="field" type="number" min="0" step="0.1" value="1"></label>'+
        '<label>Y desde borde sup. (cm)<input id="pos-y" class="field" type="number" min="0" step="0.1" value="1"></label>'+
      '</div>'+
      '<label style="display:block;margin-top:10px;font-size:12px;color:var(--muted)">Margen (cm)<input id="pdf-margin" class="field" type="number" min="0" step="0.1" value="0.6"></label>';
    const ss = dom.options.querySelector('#size'), cs = dom.options.querySelector('#customSheetSize');
    ss.onchange = () => { cs.style.display = ss.value==='Personalizado'?'':'none'; };
    const is = dom.options.querySelector('#imgsize'), ci = dom.options.querySelector('#customImgSize');
    is.onchange = () => { ci.style.display = is.value==='custom'?'':'none'; };
    const pv = dom.options.querySelector('#pos-v'), ph = dom.options.querySelector('#pos-h'), cp = dom.options.querySelector('#customPos');
    const syncPos = () => { cp.style.display = (pv.value==='custom'||ph.value==='custom')?'':'none'; };
    pv.onchange = syncPos; ph.onchange = syncPos; syncPos();
  }

  if(state.current==='mixpdf'){
    dom.options.innerHTML =
      '<div class="row">'+
        '<label>Tamaño de página<select id="size" class="field">'+defaultSheet+'<option value="Automático">Automático</option></select></label>'+
        '<label>Orientación<select id="orient" class="field"><option>Vertical</option><option>Horizontal</option><option>Automática</option></select></label>'+
      '</div>'+
      '<div id="custommixsize" class="row" style="display:none">'+
        '<label>Ancho (cm)<input id="mixw" class="field" type="number" min="1" step="0.1" value="21.59"></label>'+
        '<label>Alto (cm)<input id="mixh" class="field" type="number" min="1" step="0.1" value="27.94"></label>'+
      '</div>'+
      '<label style="display:block;margin-top:10px;font-size:12px;color:var(--muted)">Margen (cm)<input id="mix-margin" class="field" type="number" min="0" step="0.1" value="0.6"></label>';
    const s = dom.options.querySelector('#size'), row = dom.options.querySelector('#custommixsize');
    const sync = () => { row.style.display = s.value==='Personalizado'?'':'none'; };
    s.onchange = sync; sync();
  }

  if(state.current==='signature'){
    const saved = Tools.getSavedSignatures();
    dom.options.innerHTML =
      '<div class="section" style="margin-top:6px">1. Dibuja tu firma</div>'+
      '<div class="sig-draw-tools" id="sigDrawTools">'+
        '<button type="button" data-tool="pencil" title="Lápiz">✏️</button>'+
        '<button type="button" data-tool="rect" title="Rectángulo">▭</button>'+
        '<button type="button" data-tool="circle" title="Círculo">◯</button>'+
      '</div>'+
      '<div class="sig-color-group">'+
        '<label>Trazo <input type="color" id="sigStrokeColor" value="#0b1220"></label>'+
        '<label>Grosor <input type="number" id="sigStrokeWidth" min="1" max="20" step="0.5" value="2.4"></label>'+
        '<label><input type="checkbox" id="sigFillOn"> Relleno <input type="color" id="sigFillColor" value="#ffffff"></label>'+
      '</div>'+
      '<canvas id="sigCanvas" style="width:100%;height:170px;background:#fff;border:1.5px dashed var(--border);border-radius:12px;touch-action:none;display:block;cursor:crosshair;margin-top:10px"></canvas>'+
      '<div class="actions">'+
        '<button class="secondary" type="button" id="sigClear">Limpiar</button>'+
        '<button class="secondary" type="button" id="sigSave">Guardar firma</button>'+
      '</div>'+
      (saved.length?
        '<div class="section">Firmas guardadas</div><div class="saved-sigs" id="savedSigs"></div>':
        '<p class="note" style="margin-top:10px">Aún no has guardado ninguna firma.</p>');
  }

  if(state.current==='fill'){
    dom.options.innerHTML =
      '<div class="section" style="margin-top:6px">Texto a insertar</div>'+
      '<div class="fill-editor">'+
        '<textarea id="fl-text" placeholder="Escribe aquí el texto que se insertará…">Texto nuevo</textarea>'+
        '<div class="row3">'+
          '<label>Tipo de letra<select id="fl-font" class="field">'+
            '<option value="Helvetica">Helvetica</option>'+
            '<option value="HelveticaBold">Helvetica Negrita</option>'+
            '<option value="HelveticaOblique">Helvetica Cursiva</option>'+
            '<option value="TimesRoman">Times New Roman</option>'+
            '<option value="TimesRomanBold">Times Negrita</option>'+
            '<option value="TimesRomanItalic">Times Cursiva</option>'+
            '<option value="Courier">Courier New</option>'+
            '<option value="CourierBold">Courier Negrita</option>'+
            '<option value="CourierOblique">Courier Cursiva</option>'+
            '<option value="Symbol">Symbol</option>'+
            '<option value="ZapfDingbats">Zapf Dingbats</option>'+
          '</select></label>'+
          '<label>Tamaño (pt)<input id="fl-size" class="field" type="number" min="6" max="200" step="1" value="14"></label>'+
          '<label>Color de letra<input id="fl-color" class="field" type="color" value="#000000" style="height:42px;padding:3px"></label>'+
        '</div>'+
        '<div class="row">'+
          '<label>Color de fondo<div style="display:flex;align-items:center;gap:8px;margin-top:5px">'+
            '<input type="checkbox" id="fl-bg-on">'+
            '<input id="fl-bg" type="color" value="#ffff00" style="width:44px;height:32px;border:1px solid var(--border);border-radius:6px;padding:2px">'+
            '<span class="fill-bg-preview" id="fl-bg-preview" title="Transparente"></span>'+
          '</div></label>'+
          '<label>Estilo<select id="fl-style" class="field"><option value="">Normal</option><option value="bold">Negrita</option><option value="italic">Cursiva</option><option value="bolditalic">Negrita + Cursiva</option></select></label>'+
        '</div>'+
        '<div class="row">'+
          '<label>Subrayado<select id="fl-underline" class="field"><option value="0">No</option><option value="1">Sí</option></select></label>'+
          '<label>&nbsp;<button class="secondary" type="button" id="fl-add" style="width:100%">+ Añadir texto con este estilo</button></label>'+
        '</div>'+
      '</div>'+
      '<p class="note" style="margin-top:10px">Añade tantos textos como quieras. Arrástralos sobre la vista previa para colocarlos, y usa el handle inferior derecho para cambiar su tamaño. Si seleccionas un texto ya añadido, puedes cambiarle los valores y pulsar “Actualizar seleccionado”.</p>'+
      '<div class="actions">'+
        '<button class="secondary" type="button" id="fl-update" style="display:none">Actualizar seleccionado</button>'+
      '</div>';
    const bgOn = dom.options.querySelector('#fl-bg-on');
    const bgInput = dom.options.querySelector('#fl-bg');
    const bgPreview = dom.options.querySelector('#fl-bg-preview');
    const syncBg = () => {
      if(bgOn.checked){ bgPreview.style.background = bgInput.value; bgPreview.title = bgInput.value; }
      else { bgPreview.style.background = 'transparent'; bgPreview.title = 'Transparente'; }
    };
    bgOn.onchange = syncBg; bgInput.oninput = syncBg; syncBg();

    dom.options.querySelector('#fl-add').onclick = () => {
      if(!state.pdfDoc){msg('Carga primero un PDF.');return}
      Tools.addFillItem(1);
    };
    dom.options.querySelector('#fl-update').onclick = () => {
      Tools.updateSelectedFillItem();
    };
  }

  if(state.current==='watermark'){
    dom.options.innerHTML =
      '<div class="section" style="margin-top:6px">1. Tipo de marca</div>'+
      '<div class="wm-tabs">'+
        '<button type="button" data-wm="text" class="on">Texto</button>'+
        '<button type="button" data-wm="image">Imagen</button>'+
        '<button type="button" data-wm="pdf">PDF</button>'+
      '</div>'+
      '<div id="wm-body" style="margin-top:10px"></div>';
    Tools.wireWatermarkTabs();
  }

  if(state.current==='textedit'){
    dom.options.innerHTML =
      '<div class="editor-wrap">'+
        '<div class="editor-toolbar">'+
          '<div class="tb-group">'+
            '<select id="tb-font" title="Tipo de letra"><option value="Arial, Helvetica, sans-serif">Arial</option><option value="Times New Roman, Times, serif">Times New Roman</option><option value="Courier New, Courier, monospace">Courier New</option><option value="Georgia, serif">Georgia</option><option value="Verdana, sans-serif">Verdana</option><option value="Tahoma, sans-serif">Tahoma</option></select>'+
            '<select id="tb-size" title="Tamaño"><option value="10">10</option><option value="12" selected>12</option><option value="14">14</option><option value="16">16</option><option value="18">18</option><option value="20">20</option><option value="24">24</option><option value="28">28</option><option value="32">32</option><option value="48">48</option><option value="72">72</option><option value="86">86</option></select>'+
          '</div>'+
          '<div class="tb-group">'+
            '<button type="button" class="tb-icon-btn" data-cmd="bold" title="Negrita"><img class="tb-icon" src="./icons/tools/bold-text.png" alt=""></button>'+
            '<button type="button" class="tb-icon-btn" data-cmd="italic" title="Cursiva"><img class="tb-icon" src="./icons/tools/italic.png" alt=""></button>'+
            '<button type="button" class="tb-icon-btn" data-cmd="underline" title="Subrayado"><img class="tb-icon" src="./icons/tools/underline.png" alt=""></button>'+
            '<button type="button" class="tb-icon-btn" data-cmd="strikeThrough" title="Tachado"><img class="tb-icon" src="./icons/tools/strikethrough.png" alt=""></button>'+
            '<input type="color" id="tb-fg" value="#000000" title="Color de letra">'+
            '<input type="color" id="tb-bg" value="#ffff00" title="Color de fondo">'+
          '</div>'+
          '<div class="tb-group">'+
            '<button type="button" class="tb-icon-btn" data-cmd="justifyLeft" title="Izquierda"><img class="tb-icon" src="./icons/tools/align-left.png" alt=""></button>'+
            '<button type="button" class="tb-icon-btn" data-cmd="justifyCenter" title="Centrar"><img class="tb-icon" src="./icons/tools/align-center.png" alt=""></button>'+
            '<button type="button" class="tb-icon-btn" data-cmd="justifyRight" title="Derecha"><img class="tb-icon" src="./icons/tools/align-right.png" alt=""></button>'+
            '<button type="button" class="tb-icon-btn" data-cmd="justifyFull" title="Justificar"><img class="tb-icon" src="./icons/tools/align-justify.png" alt=""></button>'+
          '</div>'+
          '<div class="tb-group">'+
            '<button type="button" class="tb-icon-btn" id="tb-bullet" title="Viñetas"><img class="tb-icon" src="./icons/tools/bullet.png" alt=""></button>'+
            '<button type="button" class="tb-icon-btn" data-cmd="insertOrderedList" title="Numeración"><img class="tb-icon" src="./icons/tools/enumerate.png" alt=""></button>'+
            '<button type="button" class="tb-icon-btn" data-cmd="indent" title="Aumentar sangría"><img class="tb-icon" src="./icons/tools/increase-indent.png" alt=""></button>'+
            '<button type="button" class="tb-icon-btn" data-cmd="outdent" title="Reducir sangría"><img class="tb-icon" src="./icons/tools/decrease-indent.png" alt=""></button>'+
          '</div>'+
          '<div class="tb-group">'+
            '<img class="tb-icon" src="./icons/tools/line-spacing.png" alt="" style="align-self:center;margin:0 4px">'+
            '<select id="tb-lineheight" title="Interlineado">'+
              '<option value="1">Sencillo (1.0)</option>'+
              '<option value="1.5" selected>1.5 Líneas</option>'+
              '<option value="2">Doble (2.0)</option>'+
            '</select>'+
          '</div>'+
          '<div class="tb-group">'+
            '<button type="button" class="tb-icon-btn" id="tb-clear" title="Limpiar formato">Tx</button>'+
          '</div>'+
        '</div>'+
        '<div id="editor" class="editor" contenteditable="true" spellcheck="false"><p>Escribe aquí tu texto…</p></div>'+
      '</div>'+
      '<label style="display:block;margin-top:14px;font-size:12px;color:var(--muted)">Tamaño de hoja<select id="txt-size" class="field">'+defaultSheet+'</select></label>'+
      '<div class="row">'+
        '<label>Orientación<select id="txt-orient" class="field"><option>Vertical</option><option>Horizontal</option></select></label>'+
        '<label>Margen (cm)<input id="txt-margin" class="field" type="number" min="0" step="0.1" value="0.6"></label>'+
      '</div>'+
      '<div id="txt-custom" class="row" style="display:none">'+
        '<label>Ancho (cm)<input id="txt-w" class="field" type="number" min="1" step="0.1" value="21.59"></label>'+
        '<label>Alto (cm)<input id="txt-h" class="field" type="number" min="1" step="0.1" value="27.94"></label>'+
      '</div>'+
      '<div class="actions"><button class="primary" type="button" id="tb-print">Guardar</button></div>';
    Tools.wireEditor();
    const ts = dom.options.querySelector('#txt-size'), tc = dom.options.querySelector('#txt-custom');
    const syncTs = () => { tc.style.display = ts.value==='Personalizado'?'':'none'; };
    ts.onchange = syncTs; syncTs();
  }

  if(state.current==='web'){
    dom.options.innerHTML =
      '<label style="display:block;font-size:12px;color:var(--muted)">URL de la página<input id="web-url" class="field" type="url" placeholder="https://ejemplo.com" autocomplete="off" spellcheck="false"></label>'+
      '<div class="row">'+
        '<label>Tamaño de pantalla<select id="web-screen" class="field"><option value="375x667">Móvil · 375 × 667</option><option value="768x1024">Tablet · 768 × 1024</option><option value="1024x768">Tablet horiz. · 1024 × 768</option><option value="1366x768" selected>Escritorio · 1366 × 768</option><option value="1920x1080">Escritorio HD · 1920 × 1080</option><option value="custom">Personalizado…</option></select></label>'+
        '<label>Tamaño de hoja<select id="web-page" class="field">'+defaultSheet+'</select></label>'+
      '</div>'+
      '<div id="web-customscreen" class="row" style="display:none">'+
        '<label>Ancho pantalla (px)<input id="web-sw" class="field" type="number" min="240" step="1" value="1366"></label>'+
        '<label>Alto pantalla (px)<input id="web-sh" class="field" type="number" min="240" step="1" value="768"></label>'+
      '</div>'+
      '<div id="web-custompage" class="row" style="display:none">'+
        '<label>Ancho hoja (cm)<input id="web-pw" class="field" type="number" min="1" step="0.1" value="21.59"></label>'+
        '<label>Alto hoja (cm)<input id="web-ph" class="field" type="number" min="1" step="0.1" value="27.94"></label>'+
      '</div>'+
      '<div class="row">'+
        '<label>Orientación<select id="web-orient" class="field"><option>Vertical</option><option>Horizontal</option></select></label>'+
        '<label>Margen (cm)<input id="web-margin" class="field" type="number" min="0" step="0.1" value="0.6"></label>'+
      '</div>'+
      '<div class="actions"><button class="primary" type="button" id="web-go">Abrir y convertir</button></div>'+
      '<p class="note" style="margin-top:10px">Se abrirá una ventana con la página cargada y el diálogo de impresión. Elige <b>Guardar como PDF</b>.</p>';
    const screenSel = dom.options.querySelector('#web-screen'), customScreen = dom.options.querySelector('#web-customscreen');
    const pageSel = dom.options.querySelector('#web-page'), customPage = dom.options.querySelector('#web-custompage');
    screenSel.onchange = () => { customScreen.style.display = screenSel.value==='custom'?'':'none'; };
    pageSel.onchange = () => { customPage.style.display = pageSel.value==='Personalizado'?'':'none'; };
    dom.options.querySelector('#web-go').onclick = () => { try{ Tools.makeWebPdf(); }catch(e){ msg(e.message); } };
  }
}

/* ---------- Abrir herramienta ---------- */
export function openTool(k){
  const wasInTool = !dom.tool.classList.contains('hidden');
  reset();
  state.current = k;
  dom.home.classList.add('hidden');
  dom.tool.classList.remove('hidden');
  dom.title.textContent = toolsMeta[k].title;
  dom.desc.textContent = toolsMeta[k].desc;
  dom.file.multiple = (k==='merge'||k==='imagepdf'||k==='mixpdf');
  dom.file.accept =
    (k==='extract'||k==='merge'||k==='image'||k==='extractimg'||k==='signature'||k==='reorder'||k==='deletepage'||k==='watermark'||k==='viewer'||k==='rotate'||k==='divide'||k==='fill')?'application/pdf':
    (k==='imagepdf')?'image/*':
    (k==='mixpdf')?'application/pdf,image/*,.txt,text/plain':
    (k==='txt')?'.txt,text/plain':'text/html,.htm';
  dom.drop.querySelector('#dropText').textContent =
    k==='merge'?'Seleccionar varios PDF (se agregan)':
    k==='mixpdf'?'Seleccionar imágenes, TXT o PDF (se agregan)':
    k==='imagepdf'?'Seleccionar imágenes':
    k==='viewer'?'Seleccionar el PDF a ver':
    k==='signature'?'Seleccionar el PDF a firmar':
    k==='fill'?'Seleccionar el PDF a llenar':
    k==='divide'?'Seleccionar el PDF a dividir':
    k==='rotate'?'Seleccionar el PDF a rotar':
    k==='extractimg'?'Seleccionar el PDF':
    k==='watermark'?'Seleccionar el PDF':
    k==='reorder'||k==='deletepage'?'Seleccionar el PDF':'Seleccionar archivo';
  if(k==='textedit'||k==='web') dom.drop.classList.add('hidden'); else dom.drop.classList.remove('hidden');
  renderOptions();
  updateNavBtn();
  if(!wasInTool){ try{ history.pushState({tool:k},'','#'+k); }catch(e){} }
  else{ try{ history.replaceState({tool:k},'','#'+k); }catch(e){} }
}

/* ---------- Carga de archivos ---------- */
export async function showFiles(fs){
  if(!fs.length)return;
  if(state.current==='merge'||state.current==='mixpdf'){
    if(state.current==='merge'){ const bad = fs.find(f=>!isPdf(f)); if(bad)return msg('Todos deben ser PDF: '+bad.name); }
    else{ const bad = fs.find(f=>fileKind(f)==='other'); if(bad)return msg('Formato no compatible: '+bad.name); }
    state.loadedFiles = state.loadedFiles.concat(fs);
    Tools.renderFileList(state.loadedFiles);
    Tools.refreshPageCounts();
    return;
  }
  state.loadedFiles = fs;
  dom.preview.innerHTML = '';
  try{
    if(state.current==='extract'){ if(!isPdf(fs[0]))return msg('Selecciona un PDF.'); await Tools.loadPdf(fs[0]); return; }
    if(state.current==='extractimg'){ if(!isPdf(fs[0]))return msg('Selecciona un PDF.'); await Tools.loadPdf(fs[0]); return; }
    if(state.current==='image'){ if(!isPdf(fs[0]))return msg('Selecciona un PDF.'); await Tools.loadPdf(fs[0]); return; }
    if(state.current==='reorder'){ if(!isPdf(fs[0]))return msg('Selecciona un PDF.'); await Tools.loadReorderPdf(fs[0]); return; }
    if(state.current==='deletepage'){ if(!isPdf(fs[0]))return msg('Selecciona un PDF.'); await Tools.loadDeletePdf(fs[0]); return; }
    if(state.current==='watermark'){ if(!isPdf(fs[0]))return msg('Selecciona un PDF.'); await Tools.loadWatermarkPdf(fs[0]); return; }
    if(state.current==='viewer'){ if(!isPdf(fs[0]))return msg('Selecciona un PDF.'); await Tools.loadViewerPdf(fs[0]); return; }
    if(state.current==='rotate'){ if(!isPdf(fs[0]))return msg('Selecciona un PDF.'); await Tools.loadRotatePdf(fs[0]); return; }
    if(state.current==='divide'){ if(!isPdf(fs[0]))return msg('Selecciona un PDF.'); await Tools.loadDividePdf(fs[0]); return; }
    if(state.current==='fill'){ if(!isPdf(fs[0]))return msg('Selecciona un PDF.'); await Tools.loadFillPdf(fs[0]); return; }
    if(state.current==='imagepdf'){
      const bad = fs.find(f=>!(f.type.startsWith('image/')||/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name)));
      if(bad)return msg('Selecciona imágenes: '+bad.name);
      Tools.renderFileList(fs);
      return;
    }
    if(state.current==='signature'){ if(!isPdf(fs[0]))return msg('Selecciona un PDF.'); await Tools.loadSignaturePdf(fs[0]); return; }
    if(state.current==='txt'){ if(!fs[0].name.toLowerCase().endsWith('.txt'))return msg('Selecciona un TXT.'); Tools.renderAction('Crear PDF', Tools.makeTxtPdf); return; }
    if(state.current==='html'){ if(!/html?/i.test(fs[0].type)&&!fs[0].name.toLowerCase().match(/\.html?$/))return msg('Selecciona un HTML.'); Tools.renderAction('Abrir vista de impresión', Tools.printHtml); }
  }catch(e){ msg(e.message); }
}

/* ---------- Punto de entrada ---------- */
async function boot(){
  window.addEventListener('online', updateNetwork);
  window.addEventListener('offline', updateNetwork);
  updateNetwork();

  // Polyfills
  if(!Uint8Array.prototype.toHex) Object.defineProperty(Uint8Array.prototype,'toHex',{value:function(){let s='';for(const b of this)s+=b.toString(16).padStart(2,'0');return s},configurable:true});
  if(!Uint8Array.fromHex) Uint8Array.fromHex = function(s){if(typeof s!=='string'||s.length%2)return new Uint8Array();const a=new Uint8Array(s.length/2);for(let i=0;i<a.length;i++)a[i]=parseInt(s.slice(i*2,i*2+2),16);return a};
  if(!Uint8Array.prototype.toBase64) Object.defineProperty(Uint8Array.prototype,'toBase64',{value:function(){let b='';for(const x of this)b+=String.fromCharCode(x);return btoa(b)},configurable:true});
  if(!Uint8Array.fromBase64) Uint8Array.fromBase64 = function(s){const b=atob(s),a=new Uint8Array(b.length);for(let i=0;i<a.length;i++)a[i]=b.charCodeAt(i);return a};
  if(!Promise.try) Promise.try = function(fn){return new Promise((r,j)=>{try{r(fn())}catch(e){j(e)}})};

  // Splash
  (function setupSplash(){
    const MIN_MS = 2000;
    const splash = document.getElementById('app-splash');
    if(!splash)return;
    const start = performance.now();
    const hide = () => { if(!splash.isConnected)return; splash.classList.add('hide'); setTimeout(()=>{try{splash.remove()}catch(_){}},400); };
    const arm = () => { const elapsed = performance.now()-start; setTimeout(hide, Math.max(0,MIN_MS-elapsed)); };
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',arm,{once:true});
    else arm();
    setTimeout(hide,3500);
    setTimeout(hide,6000);
  })();

  // Motores
  try{
    await Engines.ensureEngines();
    dom.engine.textContent = 'Motores PDF listos';
  }catch(e){
    window.__engineError = e;
    dom.engine.textContent = 'Motor: error';
    msg('No se pudieron cargar los motores PDF. Verifica Internet en la primera ejecución.');
  }

  // Eventos de navegación
  window.addEventListener('popstate', () => { if(!dom.tool.classList.contains('hidden')) goHome(); });
  dom.navBtn.onclick = () => { if(dom.tool.classList.contains('hidden'))return; try{ history.back(); }catch(e){ goHome(); } };

  // Botones de herramientas
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => openTool(b.dataset.tool));

  // Selector de archivos
  dom.pick.onclick = () => dom.file.click();
  dom.file.onchange = () => { const fs = [...dom.file.files]; dom.file.value=''; showFiles(fs); };
  dom.drop.addEventListener('dragover', e => { e.preventDefault(); dom.drop.classList.add('drag'); });
  dom.drop.addEventListener('dragleave', () => dom.drop.classList.remove('drag'));
  dom.drop.addEventListener('drop', e => { e.preventDefault(); dom.drop.classList.remove('drag'); showFiles([...e.dataTransfer.files]); });

  updateNavBtn();
  const versionEl = document.querySelector('footer');
  if(versionEl){
    versionEl.textContent = 'Kit de Herramientas PDF PePe© 2026 · v' + (Engines.CACHE_NAME || '').replace('pdf-tools-pepe-v','0.');
  }
}

document.addEventListener('DOMContentLoaded', boot);