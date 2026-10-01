/* ==========================================================================
   tools-editor.js — Editor enriquecido + Página Web a PDF
   ========================================================================== */
import {
  CM, SHEET_SIZES, state, dom,
  msg, esc, safeText
} from './app.js';

/* ---------- Editor enriquecido ---------- */
export function wireEditor(){
  const editor = dom.options.querySelector('#editor');
  if(!editor) return;

  dom.options.querySelectorAll('[data-cmd]').forEach(btn=>{
    btn.onclick = (e) => { e.preventDefault(); editor.focus(); try{ document.execCommand(btn.dataset.cmd,false,null); }catch(_){} };
  });
  dom.options.querySelector('#tb-fg').oninput = (e) => { editor.focus(); try{ document.execCommand('foreColor',false,e.target.value); }catch(_){} };
  dom.options.querySelector('#tb-bg').oninput = (e) => { editor.focus(); try{ if(!document.execCommand('hiliteColor',false,e.target.value)) document.execCommand('backColor',false,e.target.value); }catch(_){} };
  dom.options.querySelector('#tb-font').onchange = (e) => {
    editor.focus();
    try{ document.execCommand('styleWithCSS',false,true); }catch(_){}
    try{ document.execCommand('fontName',false,e.target.value); }catch(_){}
  };
  dom.options.querySelector('#tb-size').onchange = (e) => { editor.focus(); applyEditorFontSize(parseInt(e.target.value,10)||14); };

  // Interlineado: como ya es un combo con Sencillo/1.5/Doble directamente visible,
  // no hay botón intermedio. Aplicamos al cambiar.
  const lh = dom.options.querySelector('#tb-lineheight');
  if(lh) lh.onchange = (e) => {
    const v = e.target.value;
    if(!v) return;
    editor.focus();
    const val = parseFloat(v);
    const blocks = editor.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote');
    blocks.forEach(el => { el.style.lineHeight = val; });
    if(!blocks.length) editor.style.lineHeight = val;
  };

  dom.options.querySelector('#tb-clear').onclick = (e) => {
    e.preventDefault();
    editor.focus();
    try{ document.execCommand('removeFormat',false,null); }catch(_){}
    try{ document.execCommand('formatBlock',false,'p'); }catch(_){}
  };
  const bulletBtn = dom.options.querySelector('#tb-bullet');
  if(bulletBtn) bulletBtn.onclick = (e) => { e.preventDefault(); openBulletMenu(bulletBtn); };
  const printBtn = dom.options.querySelector('#tb-print');
  if(printBtn) printBtn.onclick = () => { try{ printEditor(); }catch(e){ msg(e.message); } };
}

function openBulletMenu(anchorBtn){
  dom.options.querySelector('.bullet-menu')?.remove();
  const editor = dom.options.querySelector('#editor');
  if(!editor) return;
  editor.focus();

  // ¿Está activa una lista sin orden?
  const activeUl = getCurrentUl(editor);
  const activeType = activeUl ? (activeUl.className.match(/bullet-([a-z]+)/)||[])[1] || 'disc' : null;

  const menu = document.createElement('div');
  menu.className = 'bullet-menu';

  const order = [
    {id:'disc',   ch:'•'},
    {id:'circle', ch:'◦'},
    {id:'square', ch:'▪'},
    {id:'dash',   ch:'–'},
    {id:'check',  ch:'✓'},
    {id:'cross',  ch:'✗'},
    {id:'star',   ch:'★'},
    {id:'arrow',  ch:'➤'},
    {id:'heart',  ch:'♥'}
  ];

  // Añadimos "Ninguna" al final: quita la viñeta actual
  order.push({id:'none', ch:'∅'});

  order.forEach(b=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.ch;
    btn.title = b.id;
    if(activeType === b.id) btn.classList.add('on');
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = () => {
      if(b.id === 'none') removeCurrentBullet(editor);
      else applyBulletType(b.id);
      menu.remove();
    };
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  const r = anchorBtn.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let top = r.bottom+4, left = r.left;
  if(top+mh > window.innerHeight-8) top = Math.max(8, r.top-mh-4);
  if(left+mw > window.innerWidth-8) left = Math.max(8, window.innerWidth-mw-8);
  menu.style.top = top+'px'; menu.style.left = left+'px';

  const closer = (e) => { if(!menu.contains(e.target)){ menu.remove(); document.removeEventListener('mousedown',closer,true); } };
  setTimeout(()=>document.addEventListener('mousedown',closer,true), 50);
}

function getCurrentUl(editor){
  const sel = window.getSelection();
  if(!sel || !sel.anchorNode) return null;
  let n = sel.anchorNode;
  while(n && n!==editor){
    if(n.nodeType===1 && n.tagName && n.tagName.toLowerCase()==='ul') return n;
    n = n.parentNode;
  }
  return null;
}

function applyBulletType(type){
  const editor = dom.options.querySelector('#editor');
  if(!editor) return;
  editor.focus();
  let ul = getCurrentUl(editor);
  if(!ul){
    try{ document.execCommand('insertUnorderedList',false,null); }catch(_){}
    ul = getCurrentUl(editor);
  }
  if(!ul) return;
  [...ul.classList].forEach(c=>{ if(c.startsWith('bullet-')) ul.classList.remove(c); });
  ul.classList.add('bullet-'+type);
}

/** Quita la viñeta actual: convierte el UL en párrafos normales. */
function removeCurrentBullet(editor){
  editor.focus();
  // Si hay una lista activa, la deshacemos
  try{ document.execCommand('insertUnorderedList',false,null); }catch(_){}
  // Y limpiamos cualquier clase bullet-* que hubiera quedado
  editor.querySelectorAll('ul').forEach(ul=>{
    [...ul.classList].forEach(c=>{ if(c.startsWith('bullet-')) ul.classList.remove(c); });
  });
}

function applyEditorFontSize(px){
  const editor = dom.options.querySelector('#editor');
  if(!editor) return;
  editor.focus();
  try{ document.execCommand('fontSize',false,'7'); }catch(_){}
  editor.querySelectorAll('font[size="7"]').forEach(el=>{ el.removeAttribute('size'); el.style.fontSize = px+'px'; });
}

function printEditor(){
  const editor = dom.options.querySelector('#editor');
  if(!editor) throw new Error('El editor no está disponible.');
  if(!editor.textContent.trim()) throw new Error('El editor está vacío.');
  const sheetSel = dom.options.querySelector('#txt-size')?.value||'Carta';
  const orient = dom.options.querySelector('#txt-orient')?.value||'Vertical';
  const customW = parseFloat(dom.options.querySelector('#txt-w')?.value)||21.59;
  const customH = parseFloat(dom.options.querySelector('#txt-h')?.value)||27.94;
  let marginCm = parseFloat(dom.options.querySelector('#txt-margin')?.value);
  if(isNaN(marginCm)) marginCm = 0.6;
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
  if(!w) throw new Error('El navegador bloqueó la ventana de impresión.');
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
  setTimeout(()=>{ try{ w.print(); }catch(e){} }, 500);
}

/* ---------- Página Web a PDF ---------- */
export function makeWebPdf(){
  const urlInput = dom.options.querySelector('#web-url');
  let url = (urlInput?.value||'').trim();
  if(!url) throw new Error('Escribe una URL.');
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
  if(isNaN(marginCm)) marginCm = 0.6;
  const marginMm = (marginCm*10).toFixed(2);
  const features = 'width='+sw+',height='+sh+',menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes';
  const popup = window.open('','_blank',features);
  if(!popup) throw new Error('El navegador bloqueó la ventana emergente.');
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