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
 * Renderiza a primeira página do PDF para um canvas do node-canvas.
 * @returns {{ canvas: import('canvas').Canvas, width: number, height: number }}
 */
async function renderPdfFirstPage(pdfBuffer) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(pdfBuffer);
  const factory = new NodeCanvasFactory();
  const loadingTask = pdfjs.getDocument({
    data,
    canvasFactory: factory,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
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

async function pdfToPngBuffer(pdfBuffer) {
  const { canvas } = await renderPdfFirstPage(pdfBuffer);
  return canvas.toBuffer('image/png');
}

module.exports = {
  renderPdfFirstPage,
  pdfToPngBuffer,
};
