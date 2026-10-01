/* ==========================================================================
   tools-viewer.js — Visor PDF v2
   ========================================================================== */
import {
  CM, state, dom,
  msg, esc, fileSize, base, busy, dl,
  renderThumbOnPage
} from './app.js';

/* ---------- Visor PDF v2 ---------- */
export async function loadViewerPdf(f){
  if(!window.pdfjsLib) throw new Error('pdf.js no disponible');
  if(f) state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
  if(!state.pdfDoc) throw new Error('Selecciona un PDF.');
  state._viewerScale = 1;
  state._viewerPage = 1;
  mountViewerV2();
}

function mountViewerV2(){
  document.querySelector('#viewerV2')?.remove();
  const container = document.createElement('div');
  container.id = 'viewerV2';
  container.className = 'viewer-v2';
  container.innerHTML =
    '<div class="viewer-topbar">'+
      '<div class="viewer-title">Visor PDF</div>'+
      '<div class="viewer-actions">'+
        '<button type="button" id="vv-open" title="Abrir otro PDF">📂</button>'+
        '<button type="button" id="vv-save" title="Guardar copia">💾</button>'+
        '<button type="button" id="vv-prev" title="Página anterior">◀</button>'+
        '<span class="viewer-counter" id="vv-page">1 / 1</span>'+
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
  const empty = container.querySelector('#vv-empty');
  const drop = container.querySelector('#vv-drop');

  const openBtn   = container.querySelector('#vv-open');
  const saveBtn   = container.querySelector('#vv-save');
  const prevBtn   = container.querySelector('#vv-prev');
  const nextBtn   = container.querySelector('#vv-next');
  const zinBtn    = container.querySelector('#vv-zin');
  const zoutBtn   = container.querySelector('#vv-zout');
  const fitBtn    = container.querySelector('#vv-fit');
  const searchBtn = container.querySelector('#vv-search');
  const closeBtn  = container.querySelector('#vv-close');
  const pageLbl   = container.querySelector('#vv-page');
  const scaleLbl  = container.querySelector('#vv-scale');

  const searchBar   = container.querySelector('#vv-searchbar');
  const searchInput = container.querySelector('#vv-searchinput');
  const searchPrev  = container.querySelector('#vv-searchprev');
  const searchNext  = container.querySelector('#vv-searchnext');
  const searchCount = container.querySelector('#vv-searchcount');
  const searchClose = container.querySelector('#vv-searchclose');

  function closeViewer(){
    document.querySelector('.app').style.display = '';
    container.remove();
    document.querySelector('#tool').classList.add('hidden');
    document.querySelector('#home').classList.remove('hidden');
    state.pdfDoc = null;
  }
  closeBtn.onclick = closeViewer;

  openBtn.onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'application/pdf';
    inp.onchange = async () => {
      const f = inp.files[0]; if(!f)return;
      state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
      state._viewerScale = 1; state._viewerPage = 1;
      renderAllPages();
    };
    inp.click();
  };

  saveBtn.onclick = async () => {
    if(!state.pdfDoc)return;
    const bytes = await state.pdfDoc.getData();
    await dl(bytes, 'documento_copia.pdf');
  };

  zinBtn.onclick  = () => { state._viewerScale = Math.min(4, state._viewerScale*1.2); applyZoom(); };
  zoutBtn.onclick = () => { state._viewerScale = Math.max(.3, state._viewerScale/1.2); applyZoom(); };
  fitBtn.onclick  = () => { state._viewerScale = 1; applyZoom(); };

  prevBtn.onclick = () => scrollToPage(Math.max(1, state._viewerPage - 1));
  nextBtn.onclick = () => scrollToPage(Math.min(state.pdfDoc?.numPages||1, state._viewerPage + 1));

  searchBtn.onclick = () => {
    searchBar.classList.toggle('on');
    if(searchBar.classList.contains('on')) searchInput.focus();
  };
  searchClose.onclick = () => { searchBar.classList.remove('on'); };
  searchInput.oninput = debounce(() => doSearch(), 300);
  searchPrev.onclick  = () => jumpSearch(-1);
  searchNext.onclick  = () => jumpSearch(1);

  // Ctrl + rueda = zoom
  pageWrap.addEventListener('wheel', (e) => {
    if(!e.ctrlKey) return;
    e.preventDefault();
    if(e.deltaY < 0) state._viewerScale = Math.min(4, state._viewerScale*1.1);
    else             state._viewerScale = Math.max(.3, state._viewerScale/1.1);
    applyZoom();
  }, {passive:false});

  // Pinch-to-zoom
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

  // Drag & drop
  drop.onclick = () => openBtn.click();
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', async (e) => {
    const f = e.dataTransfer.files[0];
    if(!f)return;
    state.pdfDoc = await window.pdfjsLib.getDocument({data: await f.arrayBuffer()}).promise;
    state._viewerScale = 1; state._viewerPage = 1;
    renderAllPages();
  });

  /* --- render --- */
  function applyZoom(){
    if(!state._viewerPageWrappers || !state._viewerPageWrappers.length) return;
    const containerW = pageWrap.clientWidth;
    state._viewerPageWrappers.forEach(({canvas, page}) => {
      renderCanvasAtZoom(canvas, page, containerW);
    });
    if(scaleLbl) scaleLbl.textContent = Math.round(state._viewerScale*100) + '%';
  }

  async function renderCanvasAtZoom(canvas, page, containerW){
    const baseVp = page.getViewport({scale:1});
    // Dejamos 28px a cada lado para que respire y nunca toque los bordes.
    const availW = Math.max(80, containerW - 56);
    const fitScale = availW / baseVp.width;
    const scale = fitScale * state._viewerScale;
    const vp = page.getViewport({scale});
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    canvas.style.width = vp.width+'px';
    canvas.style.height = vp.height+'px';
    await page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise;
  }

  async function renderAllPages(){
    if(!state.pdfDoc)return;
    empty.style.display = 'none';
    pageWrap.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'viewer-page-wrap';
    pageWrap.appendChild(wrap);
    state._viewerPageWrappers = [];

    const containerW = pageWrap.clientWidth;
    for(let n = 1; n <= state.pdfDoc.numPages; n++){
      const page = await state.pdfDoc.getPage(n);
      const canvas = document.createElement('canvas');
      canvas.className = 'page-canvas';
      canvas.dataset.page = n;
      wrap.appendChild(canvas);
      state._viewerPageWrappers.push({canvas, page});
      await renderCanvasAtZoom(canvas, page, containerW);
    }
    updatePageLabel();
    if(scaleLbl) scaleLbl.textContent = Math.round(state._viewerScale*100) + '%';
  }

  function updatePageLabel(){
    if(pageLbl) pageLbl.textContent = state._viewerPage + ' / ' + (state.pdfDoc?.numPages||1);
  }

  function scrollToPage(n){
    const item = state._viewerPageWrappers[n-1];
    if(!item)return;
    state._viewerPage = n;
    updatePageLabel();
    item.canvas.scrollIntoView({behavior:'smooth', block:'start'});
  }

  // Detecta en qué página estamos al hacer scroll
  pageWrap.addEventListener('scroll', debounce(() => {
    if(!state._viewerPageWrappers?.length) return;
    const top = pageWrap.scrollTop;
    let best = 1, bestDist = Infinity;
    state._viewerPageWrappers.forEach(({canvas}, idx) => {
      const d = Math.abs(canvas.offsetTop - top - 20);
      if(d < bestDist){ bestDist = d; best = idx+1; }
    });
    state._viewerPage = best;
    updatePageLabel();
  }, 120));

  // Búsqueda
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
    searchCount.textContent = (searchResults.length? '1' : '0') + '/' + searchResults.length;
    if(searchResults.length){ searchIndex = 0; scrollToPage(searchResults[0]); }
  }
  function jumpSearch(dir){
    if(!searchResults.length) return;
    searchIndex = (searchIndex + dir + searchResults.length) % searchResults.length;
    searchCount.textContent = (searchIndex+1)+'/'+searchResults.length;
    scrollToPage(searchResults[searchIndex]);
  }

  if(state.pdfDoc) renderAllPages();
  else empty.style.display = '';

  window.addEventListener('resize', debounce(applyZoom, 250));
}

function debounce(fn, ms){ let t; return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), ms); }; }