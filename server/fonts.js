const fs = require('fs');
const path = require('path');

/** Lista única em public/font-choices.json — mesma do seletor na interface. */
const jsonPath = path.join(__dirname, '..', 'public', 'font-choices.json');
let ALLOWED_FONTS;
try {
  ALLOWED_FONTS = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
} catch (e) {
  ALLOWED_FONTS = [
    'Segoe UI',
    'Arial',
    'Times New Roman',
    'Georgia',
    'Calibri',
    'Verdana',
    'Courier New',
    'Tahoma',
  ];
}

function sanitizeFontFamily(name) {
  const n = String(name || '').trim();
  return ALLOWED_FONTS.includes(n) ? n : 'Segoe UI';
}

const MANIFEST_PATH = path.join(__dirname, 'webfonts-manifest.json');

/** Fontes em `server/webfonts` (manifest; só Regular): Pango precisa de peso 400 ou cai para fallback. */
function loadBundledWebFontFamilies() {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (!Array.isArray(m)) return [];
    return m.map((x) => x && x.choicesName).filter(Boolean);
  } catch {
    return ['Mea Culpa', 'Meie Script'];
  }
}

const BUNDLED_WEB_FONT_FAMILIES = loadBundledWebFontFamilies();

module.exports = {
  ALLOWED_FONTS,
  sanitizeFontFamily,
  BUNDLED_WEB_FONT_FAMILIES,
};
