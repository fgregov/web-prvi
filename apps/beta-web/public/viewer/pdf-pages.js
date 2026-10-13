// Renders a PDF into a container with pdf.js: one canvas per page, the first
// page at once, the rest when they come close to the screen. Used by the
// customer's offer viewer (/o/{token}) and the salesperson's preview.
// No text layer, no scripts, no XFA: the document is only drawn.

/** pdf.js of this server (the demo build points this at a CDN copy of the same version). */
export const PDFJS_BASE = '/viewer/pdfjs';
/** Its legacy build, polyfilled for older phones (the server maps build/ to it). */
export const PDFJS_BUILD = `${PDFJS_BASE}/build`;

let loaded = null;
function loadPdfJs(build) {
  loaded ??= import(/* @vite-ignore */ `${build}/pdf.min.mjs`).then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = `${build}/pdf.worker.min.mjs`;
    return pdfjs;
  });
  return loaded;
}

/**
 * @param {HTMLElement} container  receives one <canvas> per page
 * @param {ArrayBuffer} data
 * @param {{ base?: string, build?: string, label?: string }} [options]
 * @returns {Promise<{ pageCount: number }>} once the first page is drawn
 */
export async function renderPdf(
  container,
  data,
  { base = PDFJS_BASE, build = PDFJS_BUILD, label = 'Stranica' } = {},
) {
  const pdfjs = await loadPdfJs(build);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    cMapUrl: `${base}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}/standard_fonts/`,
    wasmUrl: `${base}/wasm/`,
    enableXfa: false,
  }).promise;

  const width = Math.max(280, Math.min(container.clientWidth || 600, 1000));
  const ratio = Math.min(window.devicePixelRatio || 1, 2);

  async function draw(canvas, number) {
    const page = await doc.getPage(number);
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: (width / unscaled.width) * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    canvas.dataset.rendered = 'true';
  }

  const canvases = [];
  for (let n = 1; n <= doc.numPages; n += 1) {
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${label} ${n} od ${doc.numPages}`);
    canvas.dataset.page = String(n);
    // Space for pages not drawn yet (A4 portrait until known).
    canvas.style.aspectRatio = '595 / 842';
    container.append(canvas);
    canvases.push(canvas);
  }
  await draw(canvases[0], 1);
  canvases[0].style.aspectRatio = '';

  const rest = canvases.slice(1);
  if (rest.length) {
    const observer =
      'IntersectionObserver' in window
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                observer.unobserve(entry.target);
                const n = Number(entry.target.dataset.page);
                draw(entry.target, n)
                  .then(() => {
                    entry.target.style.aspectRatio = '';
                  })
                  .catch(() => {});
              }
            },
            { rootMargin: '600px 0px' },
          )
        : null;
    for (const canvas of rest) {
      if (observer) observer.observe(canvas);
      else draw(canvas, Number(canvas.dataset.page)).catch(() => {});
    }
  }
  return { pageCount: doc.numPages };
}
