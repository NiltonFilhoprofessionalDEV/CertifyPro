const path = require('path');
const { pathToFileURL } = require('url');
const { createCanvas } = require('canvas');

/** pdfjs-dist 4+ só distribui ESM (.mjs); require do .js antigo não existe mais. */
let pdfjsLibPromise;
function getPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
      const workerFile = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'legacy', 'build', 'pdf.worker.mjs');
      m.GlobalWorkerOptions.workerSrc = pathToFileURL(workerFile).href;
      return m;
    });
  }
  return pdfjsLibPromise;
}

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d');
    return { canvas, context };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

/**
 * Renderiza uma página do PDF para um canvas do node-canvas.
 * @returns {{ canvas: import('canvas').Canvas, width: number, height: number }}
 */
async function renderPdfPage(pdfBuffer, pageNumber) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(pdfBuffer);
  const factory = new NodeCanvasFactory();
  const loadingTask = pdfjs.getDocument({
    data,
    canvasFactory: factory,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const canvasAndContext = factory.create(viewport.width, viewport.height);
  const renderContext = {
    canvasContext: canvasAndContext.context,
    viewport,
  };
  await page.render(renderContext).promise;
  return {
    canvas: canvasAndContext.canvas,
    width: Math.round(viewport.width),
    height: Math.round(viewport.height),
  };
}

async function renderPdfPages(pdfBuffer) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(pdfBuffer);
  const factory = new NodeCanvasFactory();
  const loadingTask = pdfjs.getDocument({
    data,
    canvasFactory: factory,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const canvasAndContext = factory.create(viewport.width, viewport.height);
    const renderContext = {
      canvasContext: canvasAndContext.context,
      viewport,
    };
    await page.render(renderContext).promise;
    pages.push({
      canvas: canvasAndContext.canvas,
      width: Math.round(viewport.width),
      height: Math.round(viewport.height),
      pageNumber: n,
    });
  }
  return pages;
}

async function getPdfPageCount(pdfBuffer) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(pdfBuffer);
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  return pdf.numPages;
}

async function renderPdfFirstPage(pdfBuffer) {
  return renderPdfPage(pdfBuffer, 1);
}

async function pdfToPngBuffer(pdfBuffer) {
  const { canvas } = await renderPdfFirstPage(pdfBuffer);
  return canvas.toBuffer('image/png');
}

module.exports = {
  renderPdfFirstPage,
  renderPdfPages,
  pdfToPngBuffer,
  getPdfPageCount,
};
