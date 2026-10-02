/* ==========================================================================
   tools-viewer.js — Visor PDF v2
   ========================================================================== */
import {
  CM, state, dom,
  msg, esc, base, dl
} from './app.js';

/* ---------- Visor PDF v2 ---------- */
export async function loadViewerPdf(f){
  if(!window.pdfjsLib) throw new Error('pdf.js no disponible');
  if(f){
    state._viewerFileName = f.name;
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
  }
  if(!state.pdfDoc) throw new Error('Selecciona un PDF.');
  state._viewerScale = 1;
  state._viewerPage = 1;
  state._viewerSearchQuery = '';
  mountViewerV2();
}

function mountViewerV2(){
  document.querySelector('#viewerV2')?.remove();
  const container = document.createElement('div');
  container.id = 'viewerV2';
  container.className = 'viewer-v2';
  container.innerHTML =
    '<div class="viewer-topbar">'+
      '<div class="viewer-title">'+
        '<span>Visor PDF</span>'+
        '<span class="viewer-filename" id="vv-filename">—</span>'+
      '</div>'+
      '<div class="viewer-actions">'+
        '<button type="button" id="vv-open" title="Abrir otro PDF">📂</button>'+
        '<button type="button" id="vv-save" title="Guardar copia">💾</button>'+
        '<button type="button" id="vv-prev" title="Página anterior">◀</button>'+
        '<span class="viewer-counter" style="display:flex;align-items:center;gap:4px">'+
          '<input type="number" id="vv-pagenum" min="1" step="1" value="1">'+
          '<span id="vv-pagetotal">/ 1</span>'+
        '</span>'+
        '<button type="button" id="vv-next" title="Página siguiente">▶</button>'+
        '<button type="button" id="vv-zout" title="Zoom −">−</button>'+
        '<span class="viewer-counter zoom" id="vv-scale">100%</span>'+
        '<button type="button" id="vv-zin" title="Zoom +">＋</button>'+
        '<button type="button" id="vv-fit" title="Ajustar a la pantalla">⤢</button>'+
        '<button type="button" id="vv-search" title="Buscar">🔍</button>'+
        '<button type="button" id="vv-close" title="Cerrar visor">✕</button>'+
      '</div>'+
    '</div>'+
    '<div class="search-bar" id="vv-searchbar">'+
      '<input type="text" id="vv-searchinput" placeholder="Buscar texto…">'+
      '<button type="button" id="vv-searchprev">◀ Ant</button>'+
      '<button type="button" id="vv-searchnext">Sig ▶</button>'+
      '<span class="count" id="vv-searchcount">0/0</span>'+
      '<button type="button" id="vv-searchclose">Cerrar</button>'+
    '</div>'+
    '<div class="viewer-page" id="vv-pagewrap">'+
      '<div class="viewer-empty" id="vv-empty">'+
        '<div class="drop-area" id="vv-drop">'+
          '<div style="font-size:36px">📄</div>'+
          '<div style="margin-top:10px"><b>Arrastra un PDF aquí</b><br>o pulsa para abrirlo</div>'+
        '</div>'+
      '</div>'+
    '</div>';
  document.body.appendChild(container);
  document.querySelector('.app').style.display = 'none';

  const pageWrap = container.querySelector('#vv-pagewrap');
  const empty    = container.querySelector('#vv-empty');
  const drop     = container.querySelector('#vv-drop');
  const fname    = container.querySelector('#vv-filename');

  const openBtn   = container.querySelector('#vv-open');
  const saveBtn   = container.querySelector('#vv-save');
  const prevBtn   = container.querySelector('#vv-prev');
  const nextBtn   = container.querySelector('#vv-next');
  const zinBtn    = container.querySelector('#vv-zin');
  const zoutBtn   = container.querySelector('#vv-zout');
  const fitBtn    = container.querySelector('#vv-fit');
  const searchBtn = container.querySelector('#vv-search');
  const closeBtn  = container.querySelector('#vv-close');
  const pageInput = container.querySelector('#vv-pagenum');
  const pageTotal = container.querySelector('#vv-pagetotal');
  const scaleLbl  = container.querySelector('#vv-scale');

  const searchBar   = container.querySelector('#vv-searchbar');
  const searchInput = container.querySelector('#vv-searchinput');
  const searchPrev  = container.querySelector('#vv-searchprev');
  const searchNext  = container.querySelector('#vv-searchnext');
  const searchCount = container.querySelector('#vv-searchcount');
  const searchClose = container.querySelector('#vv-searchclose');

  // Nombre del archivo
  if(fname) fname.textContent = state._viewerFileName || '—';

  /* ---------- Cerrar ---------- */
  function closeViewer(){
    document.querySelector('.app').style.display = '';
    container.remove();
    document.querySelector('#tool').classList.add('hidden');
    document.querySelector('#home').classList.remove('hidden');
    state.pdfDoc = null;
    state._viewerFileName = null;
  }
  closeBtn.onclick = closeViewer;

  /* ---------- Abrir otro PDF ---------- */
  openBtn.onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/pdf';
    inp.onchange = async () => {
      const f = inp.files[0]; if(!f) return;
      state._viewerFileName = f.name;
      if(fname) fname.textContent = f.name;
      state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
      state._viewerScale = 1; state._viewerPage = 1;
      renderAllPages();
    };
    inp.click();
  };

  /* ---------- Guardar copia ---------- */
  saveBtn.onclick = async () => {
    if(!state.pdfDoc) return;
    const bytes = await state.pdfDoc.getData();
    const name = (state._viewerFileName || 'documento.pdf').replace(/\.pdf$/i,'') + '_copia.pdf';
    await dl(bytes, name);
  };

  /* ---------- Zoom ---------- */
  zinBtn.onclick  = () => { state._viewerScale = Math.min(4, state._viewerScale*1.2); applyZoom(); };
  zoutBtn.onclick = () => { state._viewerScale = Math.max(.3, state._viewerScale/1.2); applyZoom(); };
  fitBtn.onclick  = () => { state._viewerScale = 1; applyZoom(); };

  /* ---------- Navegación por páginas ---------- */
  prevBtn.onclick = () => scrollToPage(Math.max(1, state._viewerPage - 1));
  nextBtn.onclick = () => scrollToPage(Math.min(state.pdfDoc?.numPages || 1, state._viewerPage + 1));

  pageInput.addEventListener('change', () => {
    if(!state.pdfDoc) return;
    let n = parseInt(pageInput.value, 10);
    if(isNaN(n) || n < 1) n = 1;
    if(n > state.pdfDoc.numPages) n = state.pdfDoc.numPages;
    pageInput.value = n;
    scrollToPage(n);
  });
  pageInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter'){ e.preventDefault(); pageInput.blur(); }
  });

  /* ---------- Búsqueda ---------- */
  searchBtn.onclick = () => {
    searchBar.classList.toggle('on');
    if(searchBar.classList.contains('on')) searchInput.focus();
  };
  searchClose.onclick = () => { searchBar.classList.remove('on'); };
  searchInput.oninput = debounce(() => doSearch(), 300);
  searchPrev.onclick  = () => jumpSearch(-1);
  searchNext.onclick  = () => jumpSearch(1);

  /* ---------- Zoom con Ctrl + rueda ---------- */
  pageWrap.addEventListener('wheel', (e) => {
    if(!e.ctrlKey) return;
    e.preventDefault();
    if(e.deltaY < 0) state._viewerScale = Math.min(4, state._viewerScale*1.1);
    else             state._viewerScale = Math.max(.3, state._viewerScale/1.1);
    applyZoom();
  }, {passive:false});

  /* ---------- Pinch-to-zoom táctil ---------- */
  let pinchStart = null;
  pageWrap.addEventListener('touchstart', (e) => {
    if(e.touches.length === 2){
      pinchStart = { dist: touchDist(e.touches), scale: state._viewerScale };
    }
  }, {passive:true});
  pageWrap.addEventListener('touchmove', (e) => {
    if(pinchStart && e.touches.length === 2){
      e.preventDefault();
      const d = touchDist(e.touches);
      state._viewerScale = Math.max(.3, Math.min(4, pinchStart.scale * (d / pinchStart.dist)));
      applyZoom();
    }
  }, {passive:false});
  pageWrap.addEventListener('touchend', () => { pinchStart = null; });
  function touchDist(t){
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  }

  /* ---------- Drag & drop ---------- */
  drop.onclick = () => openBtn.click();
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', async (e) => {
    const f = e.dataTransfer.files[0];
    if(!f) return;
    state._viewerFileName = f.name;
    if(fname) fname.textContent = f.name;
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    state._viewerScale = 1; state._viewerPage = 1;
    renderAllPages();
  });

  /* ==========================================================
     Render
     ========================================================== */

  function applyZoom(){
    if(!state._viewerPageWrappers || !state._viewerPageWrappers.length) return;
    const containerW = pageWrap.clientWidth;
    const wrapper = pageWrap.querySelector('.viewer-page-wrap');

    // 1) Redibujar cada canvas con el nuevo zoom
    state._viewerPageWrappers.forEach(({canvas, page}) => {
      renderCanvasAtZoom(canvas, page, containerW);
    });

    // 2) Tras redibujar, recalcular textLayer y centrado
    requestAnimationFrame(async () => {
      for(const {canvas, page, textLayer} of state._viewerPageWrappers){
        await renderTextLayer(page, textLayer, canvas);
      }
      if(wrapper){
        const maxW = state._viewerPageWrappers.reduce((m,{canvas}) => Math.max(m, canvas.offsetWidth), 0);
        if(maxW <= containerW - 28) wrapper.classList.add('centered');
        else wrapper.classList.remove('centered');
      }
    });

    if(scaleLbl) scaleLbl.textContent = Math.round(state._viewerScale*100) + '%';
  }

  async function renderCanvasAtZoom(canvas, page, containerW){
    const baseVp = page.getViewport({scale:1});
    // Ajuste base al ancho disponible, multiplicado por el zoom relativo
    const availW = Math.max(80, containerW - 28);
    const fitScale = availW / baseVp.width;
    const scale = fitScale * state._viewerScale;
    const vp = page.getViewport({scale});
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    canvas.style.width  = vp.width  + 'px';
    canvas.style.height = vp.height + 'px';
    await page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise;
  }

  async function renderTextLayer(page, textLayerDiv, canvas){
    try{
      const viewport = page.getViewport({scale: 1});
      const textContent = await page.getTextContent();
      const cssW = canvas.clientWidth  || canvas.width;
      const cssH = canvas.clientHeight || canvas.height;
      const kx = cssW / viewport.width;
      const ky = cssH / viewport.height;

      textLayerDiv.innerHTML = '';
      textLayerDiv.style.width  = cssW + 'px';
      textLayerDiv.style.height = cssH + 'px';

      for(const item of textContent.items){
        if(!item.str) continue;
        const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const fontHeight = Math.hypot(tx[2], tx[3]) || item.height || 10;
        const angle = Math.atan2(tx[1], tx[0]);
        const span = document.createElement('span');
        span.textContent = item.str;
        span.style.position = 'absolute';
        span.style.left = (tx[4] * kx) + 'px';
        span.style.top  = ((tx[5] - fontHeight) * ky) + 'px';
        span.style.fontSize = (fontHeight * ky) + 'px';
        span.style.fontFamily = 'sans-serif';
        span.style.color = 'transparent';
        span.style.whiteSpace = 'pre';
        span.style.transformOrigin = '0% 0%';
        if(angle) span.style.transform = 'rotate(' + angle + 'rad)';
        span.style.userSelect = 'text';
        textLayerDiv.appendChild(span);
      }
    }catch(e){ /* si falla, el canvas sigue visible */ }
  }

  async function renderAllPages(){
    if(!state.pdfDoc) return;
    empty.style.display = 'none';
    pageWrap.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'viewer-page-wrap';
    pageWrap.appendChild(wrap);
    state._viewerPageWrappers = [];

    const containerW = pageWrap.clientWidth;
    for(let n = 1; n <= state.pdfDoc.numPages; n++){
      const page = await state.pdfDoc.getPage(n);

      // Wrapper por página: canvas + capa de texto superpuestos
      const pageBox = document.createElement('div');
      pageBox.className = 'page-box';
      pageBox.dataset.page = n;

      const canvas = document.createElement('canvas');
      canvas.className = 'page-canvas';
      canvas.dataset.page = n;
      // Copiar imagen al portapapeles con clic derecho
      canvas.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        try{
          const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
          if(!blob) return;
          await navigator.clipboard.write([ new ClipboardItem({'image/png': blob}) ]);
          const old = scaleLbl.textContent;
          scaleLbl.textContent = '¡Copiado!';
          setTimeout(() => { scaleLbl.textContent = old; }, 900);
        }catch(err){ console.warn('No se pudo copiar la imagen:', err); }
      });
      pageBox.appendChild(canvas);

      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      pageBox.appendChild(textLayer);

      wrap.appendChild(pageBox);
      state._viewerPageWrappers.push({canvas, page, textLayer, pageBox});

      await renderCanvasAtZoom(canvas, page, containerW);
      await renderTextLayer(page, textLayer, canvas);
    }
    updatePageLabel();

    // Centrar si el contenido cabe
    const maxW = state._viewerPageWrappers.reduce((m,{canvas}) => Math.max(m, canvas.offsetWidth), 0);
    if(maxW <= containerW - 28) wrap.classList.add('centered');

    if(scaleLbl) scaleLbl.textContent = Math.round(state._viewerScale*100) + '%';
  }

  function updatePageLabel(){
    if(pageInput) pageInput.value = state._viewerPage;
    if(pageTotal) pageTotal.textContent = '/ ' + (state.pdfDoc?.numPages || 1);
  }

  function scrollToPage(n){
    const item = state._viewerPageWrappers[n-1];
    if(!item) return;
    state._viewerPage = n;
    updatePageLabel();
    item.pageBox.scrollIntoView({behavior:'smooth', block:'start'});
  }

  // Detecta la página visible al hacer scroll
  pageWrap.addEventListener('scroll', debounce(() => {
    if(!state._viewerPageWrappers?.length) return;
    const top = pageWrap.scrollTop;
    let best = 1, bestDist = Infinity;
    state._viewerPageWrappers.forEach(({pageBox}, idx) => {
      const d = Math.abs(pageBox.offsetTop - top - 20);
      if(d < bestDist){ bestDist = d; best = idx+1; }
    });
    state._viewerPage = best;
    updatePageLabel();
  }, 120));

  /* ---------- Búsqueda de texto ---------- */
  let searchResults = [];
  let searchIndex = -1;
  async function doSearch(){
    const q = searchInput.value.trim();
    searchResults = []; searchIndex = -1;
    if(!q || !state.pdfDoc){ searchCount.textContent = '0/0'; return; }
    for(let n = 1; n <= state.pdfDoc.numPages; n++){
      const page = await state.pdfDoc.getPage(n);
      const text = await page.getTextContent();
      const str = text.items.map(it => it.str).join(' ');
      if(str.toLowerCase().includes(q.toLowerCase())) searchResults.push(n);
    }
    searchCount.textContent = (searchResults.length ? '1' : '0') + '/' + searchResults.length;
    if(searchResults.length){ searchIndex = 0; scrollToPage(searchResults[0]); }
  }
  function jumpSearch(dir){
    if(!searchResults.length) return;
    searchIndex = (searchIndex + dir + searchResults.length) % searchResults.length;
    searchCount.textContent = (searchIndex+1)+'/'+searchResults.length;
    scrollToPage(searchResults[searchIndex]);
  }

  /* ---------- Arranque ---------- */
  if(state.pdfDoc) renderAllPages();
  else empty.style.display = '';

  window.addEventListener('resize', debounce(applyZoom, 250));
}

function debounce(fn, ms){ let t; return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), ms); }; }