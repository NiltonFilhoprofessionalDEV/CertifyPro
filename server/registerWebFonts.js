const fs = require('fs');
const path = require('path');
const fontkit = require('fontkit');
const { registerFont } = require('canvas');

const MANIFEST_PATH = path.join(__dirname, 'webfonts-manifest.json');

/**
 * Nome escolhido na interface (font-choices.json) → nome interno do TTF para Pango/canvas.
 */
const WEB_FONT_PANGO_NAMES = {};

/** Caminhos reais já registados (evita registerFont duplicado). */
const registeredPaths = new Set();

const warnedMissingFile = new Set();

function loadManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const m = JSON.parse(raw);
    return Array.isArray(m) ? m : [];
  } catch {
    return [];
  }
}

/**
 * Regista TTFs em server/webfonts (manifest). Pode voltar a correr quando os ficheiros
 * aparecem (ex.: primeiro arranque sem rede, depois rede ok).
 */
function registerWebFonts() {
  const dir = path.join(__dirname, 'webfonts');
  const manifest = loadManifest();

  for (const entry of manifest) {
    const file = entry.file;
    const choicesName = entry.choicesName;
    if (!file || !choicesName) continue;

    const p = path.join(dir, file);
    if (!fs.existsSync(p)) {
      if (!warnedMissingFile.has(file)) {
        warnedMissingFile.add(file);
        console.warn(
          `[webfonts] Ficheiro em falta: server/webfonts/${file} — PDF usa fonte de sistema. ` +
            `Com rede, reinicie o servidor para descarregar (ensureWebFonts).`,
        );
      }
      continue;
    }

    let realPath;
    try {
      realPath = fs.realpathSync(p);
    } catch {
      realPath = p;
    }

    if (registeredPaths.has(realPath)) continue;

    try {
      const buf = fs.readFileSync(p);
      const font = fontkit.create(buf);
      const pangoName = font.familyName || choicesName;
      registerFont(p, { family: pangoName, weight: 'normal', style: 'normal' });
      try {
        registerFont(p, { family: pangoName, weight: 'bold', style: 'normal' });
      } catch (_) {
        /* ignore */
      }
      WEB_FONT_PANGO_NAMES[choicesName] = pangoName;
      if (pangoName !== choicesName) {
        WEB_FONT_PANGO_NAMES[pangoName] = pangoName;
      }
      registeredPaths.add(realPath);
      console.log(`[webfonts] Fonte registada para PDF: "${choicesName}" → canvas/Pango "${pangoName}"`);
    } catch (e) {
      console.warn(`[webfonts] registerFont ${file}:`, e.message);
    }
  }
}

/** Garante tentativa de registo antes de desenhar no canvas. */
function ensureCanvasFonts() {
  registerWebFonts();
}

module.exports = {
  registerWebFonts,
  ensureCanvasFonts,
  WEB_FONT_PANGO_NAMES,
  loadManifest,
};
