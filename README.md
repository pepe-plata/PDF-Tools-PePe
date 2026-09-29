# PDF Tools PePe v0.7

Versión local-first para Android.

- PDF.js 5.4.624 legacy y pdf-lib 1.17.1 se buscan primero en `./lib/`.
- Si todavía no están empaquetados, se usa CDN como respaldo y el Service Worker puede almacenarlos en caché.
- JSZip ya está incluido en `./lib/`.
- Todas las operaciones PDF se ejecutan localmente en el dispositivo.

## Estado

La estructura v0.7 ya está preparada para una instalación totalmente offline. En este entorno de construcción no se pudo descargar desde Internet `pdf-lib` y PDF.js para incluir sus binarios dentro de `lib/`; por eso v0.7 mantiene un fallback CDN y no se debe considerar todavía 100 % offline desde la primera ejecución.

Para completar el empaquetado basta con colocar estos tres archivos en `lib/`:

- `pdf-lib.min.js` — pdf-lib 1.17.1
- `pdf.mjs` — PDF.js 5.4.624 legacy
- `pdf.worker.mjs` — PDF.js 5.4.624 legacy worker

Después, el fallback CDN deja de ser necesario.
