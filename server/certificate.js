const fs = require('fs/promises');
const { createCanvas, loadImage } = require('canvas');
const { PDFDocument } = require('pdf-lib');
const { renderPdfPages } = require('./pdfRender');
const path = require('path');
const fontkit = require('fontkit');
const { sanitizeFontFamily, BUNDLED_WEB_FONT_FAMILIES } = require('./fonts');
const { WEB_FONT_PANGO_NAMES, ensureCanvasFonts, loadManifest } = require('./registerWebFonts');

function normalizeFontWeight(w) {
  const n = Math.round(Number(w));
  if (!Number.isFinite(n)) return 400;
  return Math.min(900, Math.max(300, Math.round(n / 100) * 100));
}

/**
 * Cache de fontes abertas com fontkit (choicesName → fontkit font object).
 * Usadas para renderizar texto como paths — bypass total do Pango.
 */
const fontkitCache = {};

function loadFontkitFont(choicesName) {
  if (fontkitCache[choicesName]) return fontkitCache[choicesName];
  const dir = path.join(__dirname, 'webfonts');
  const manifest = loadManifest();
  const entry = manifest.find((e) => e.choicesName === choicesName);
  if (!entry) return null;
  const p = path.join(dir, entry.file);
  try {
    const buf = require('fs').readFileSync(p);
    fontkitCache[choicesName] = fontkit.create(buf);
    return fontkitCache[choicesName];
  } catch {
    return null;
  }
}

/**
 * Desenha texto com fonte bundled via glyph paths (fontkit → canvas context API).
 * Bypass total do Pango/Cairo — garante fonte correcta mesmo sem registo de sistema.
 */
function drawFieldWithFontkit(ctx, text, field) {
  const { x, y, fontSize, align } = field;
  const family = sanitizeFontFamily(field.fontFamily);
  const font = loadFontkitFont(family);
  if (!font) return false;

  const str = String(text || '');
  if (!str) return true;

  try {
    const run = font.layout(str);
    const upem = font.unitsPerEm;
    const scale = fontSize / upem;

    /* Largura total para alinhamento */
    let totalWidth = 0;
    for (const glyph of run.glyphs) {
      totalWidth += (glyph.advanceWidth || 0) * scale;
    }

    let startX;
    if (align === 'center') {
      startX = x - totalWidth / 2;
    } else {
      startX = x;
    }

    /* Posição da baseline (equivalente a textBaseline = 'middle') */
    const ascent = (font.ascent || upem * 0.8) * scale;
    const descent = Math.abs(font.descent || upem * 0.2) * scale;
    const totalHeight = ascent + descent;
    const baselineY = y + ascent - totalHeight / 2;

    let cursorX = startX;
    for (const glyph of run.glyphs) {
      const advance = (glyph.advanceWidth || 0) * scale;
      const commands = glyph.path && glyph.path.commands;

      if (commands && commands.length > 0) {
        ctx.save();
        ctx.fillStyle = '#1a1a1a';
        /* Translate para posição; escala com Y invertido (fonte usa Y-up, canvas usa Y-down) */
        ctx.translate(cursorX, baselineY);
        ctx.scale(scale, -scale);
        ctx.beginPath();
        for (const cmd of commands) {
          const a = cmd.args;
          switch (cmd.command) {
            case 'moveTo':
              ctx.moveTo(a[0], a[1]);
              break;
            case 'lineTo':
              ctx.lineTo(a[0], a[1]);
              break;
            case 'quadraticCurveTo':
              ctx.quadraticCurveTo(a[0], a[1], a[2], a[3]);
              break;
            case 'bezierCurveTo':
              ctx.bezierCurveTo(a[0], a[1], a[2], a[3], a[4], a[5]);
              break;
            case 'closePath':
              ctx.closePath();
              break;
          }
        }
        ctx.fill();
        ctx.restore();
      }
      cursorX += advance;
    }
  } catch (e) {
    return false;
  }

  return true;
}

function drawField(ctx, text, field) {
  const { x, y, fontSize, align, fontFamily, fontWeight } = field;
  const family = sanitizeFontFamily(fontFamily);

  /* Para fontes bundled usa fontkit (paths) — evita dependência do Pango */
  if (BUNDLED_WEB_FONT_FAMILIES.includes(family)) {
    const ok = drawFieldWithFontkit(ctx, text, field);
    if (ok) return;
    /* fallback: continua para Pango */
  }

  const drawFamily = WEB_FONT_PANGO_NAMES[family] || family;
  let weight = normalizeFontWeight(fontWeight);
  /* peso keyword: evita falha do Pango ao resolver '400' vs 'normal' */
  const weightKw =
    weight <= 400 ? 'normal' : weight <= 600 ? 'bold' : `${weight}`;
  ctx.save();
  ctx.font = `${weightKw} ${fontSize}px ${drawFamily}`;
  ctx.fillStyle = '#1a1a1a';
  ctx.textBaseline = 'middle';
  if (align === 'center') {
    ctx.textAlign = 'center';
    ctx.fillText(String(text || ''), x, y);
  } else {
    ctx.textAlign = 'left';
    ctx.fillText(String(text || ''), x, y);
  }
  ctx.restore();
}

/**
 * @param {{ templatePath: string, templateType: 'image'|'pdf', width: number, height: number, layout: object }} session
 * @param {{ nome: string, cpf: string }} row
 */
function sanitizeLayoutForDraw(layout) {
  if (!layout || typeof layout !== 'object') return layout;
  const out = {};
  for (const [k, v] of Object.entries(layout)) {
    if (!v || typeof v !== 'object' || typeof v.x !== 'number' || typeof v.y !== 'number') continue;
    out[k] = {
      ...v,
      fontFamily: sanitizeFontFamily(v.fontFamily || 'Segoe UI'),
    };
  }
  return out;
}

async function buildCertificatePdfBuffer(session, row) {
  ensureCanvasFonts();
  const layout = sanitizeLayoutForDraw(session.layout);
  const pageCanvases = [];
  if (session.templateType === 'image') {
    const img = await loadImage(session.templatePath);
    const w = img.width;
    const h = img.height;
    const baseCanvas = createCanvas(w, h);
    const ctx = baseCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    scaleLayout(layout, session.width, session.height, w, h, ctx, row, session.fieldOrder);
    pageCanvases.push(baseCanvas);
  } else {
    const buf = await fs.readFile(session.templatePath);
    const pages = await renderPdfPages(buf);
    if (!pages.length) throw new Error('PDF de modelo sem páginas.');
    for (const p of pages) {
      if (p.pageNumber === 1) {
        const ctx = p.canvas.getContext('2d');
        scaleLayout(layout, session.width, session.height, p.width, p.height, ctx, row, session.fieldOrder);
      }
      pageCanvases.push(p.canvas);
    }
  }
  const doc = await PDFDocument.create();
  for (const pageCanvas of pageCanvases) {
    const png = pageCanvas.toBuffer('image/png');
    const embedded = await doc.embedPng(png);
    const outPage = doc.addPage([embedded.width, embedded.height]);
    outPage.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  }
  return Buffer.from(await doc.save());
}

/**
 * layout foi salvo em coordenadas do preview (session.width x session.height).
 * Escala para o canvas real (w x h).
 */
function scaleLayout(layout, refW, refH, w, h, ctx, row, fieldOrder) {
  const sx = w / refW;
  const sy = h / refH;
  const order =
    Array.isArray(fieldOrder) && fieldOrder.length
      ? fieldOrder
      : Object.keys(layout).filter((k) => layout[k] && typeof layout[k].x === 'number');
  for (const key of order) {
    const spec = layout[key];
    if (!spec || typeof spec.x !== 'number') continue;
    const scaled = scaleField(spec, sx, sy);
    if (key === 'cpf') {
      drawField(ctx, formatCpf(row.cpf), scaled);
    } else {
      drawField(ctx, row[key] ?? '', scaled);
    }
  }
}

function scaleField(field, sx, sy) {
  return {
    x: field.x * sx,
    y: field.y * sy,
    fontSize: Math.max(8, Math.round(field.fontSize * Math.min(sx, sy))),
    align: field.align || 'center',
    fontFamily: sanitizeFontFamily(field.fontFamily || 'Segoe UI'),
    fontWeight: normalizeFontWeight(field.fontWeight),
  };
}

function formatCpf(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length === 11) {
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  return String(cpf || '');
}

function sanitizeFileName(name) {
  const base = String(name || 'participante')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._\- ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return base || 'participante';
}

module.exports = {
  buildCertificatePdfBuffer,
  sanitizeFileName,
};
