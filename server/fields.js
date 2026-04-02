/**
 * Campos padrão disponíveis na interface (nome é sempre obrigatório no fluxo).
 */
const STANDARD_FIELDS = {
  nome: {
    label: 'Nome',
    preview: 'Maria Silva Santos',
    defaultSize: (h) => Math.max(18, Math.round(h * 0.035)),
  },
  cpf: {
    label: 'CPF',
    preview: '000.000.000-00',
    defaultSize: (h) => Math.max(14, Math.round(h * 0.022)),
  },
  data: {
    label: 'Data',
    preview: '15/03/2026',
    defaultSize: (h) => Math.max(12, Math.round(h * 0.02)),
  },
  curso: {
    label: 'Curso',
    preview: 'Nome do curso (exemplo)',
    defaultSize: (h) => Math.max(12, Math.round(h * 0.02)),
  },
  horas: {
    label: 'Horas',
    preview: '40 horas',
    defaultSize: (h) => Math.max(12, Math.round(h * 0.019)),
  },
};

const STANDARD_KEYS = Object.keys(STANDARD_FIELDS);

/** Posições relativas (fração 0–1) espalhadas para evitar sobreposição inicial. */
const SPREAD_FRAC = [
  [0.5, 0.28],
  [0.22, 0.44],
  [0.78, 0.44],
  [0.5, 0.58],
  [0.5, 0.76],
  [0.28, 0.62],
  [0.72, 0.62],
  [0.35, 0.34],
  [0.65, 0.34],
  [0.5, 0.5],
];

function sanitizeFieldKey(key) {
  const s = String(key || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s || s.length > 42) return null;
  if (!/^[a-z]/.test(s)) return null;
  return s;
}

/**
 * Monta layout inicial para uma lista de chaves; preserva coordenadas de `previous` quando a chave já existia.
 */
/**
 * Escala x, y e fontSize quando o fundo troca de resolução (mantém posição relativa).
 */
function scaleLayoutProportionally(layout, oldW, oldH, newW, newH) {
  if (!layout || typeof layout !== 'object' || !oldW || !oldH || oldW < 1 || oldH < 1) {
    return {};
  }
  const sx = newW / oldW;
  const sy = newH / oldH;
  const sm = Math.min(sx, sy);
  const out = {};
  for (const k of Object.keys(layout)) {
    const p = layout[k];
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') continue;
    const pw = Number(p.fontWeight);
    out[k] = {
      x: p.x * sx,
      y: p.y * sy,
      fontSize: Math.max(8, Math.round((Number(p.fontSize) || 16) * sm)),
      fontWeight: Number.isFinite(pw) ? Math.min(900, Math.max(300, Math.round(pw / 100) * 100)) : 400,
      align: p.align === 'left' ? 'left' : 'center',
      fontFamily: p.fontFamily || 'Segoe UI',
    };
  }
  return out;
}

function buildLayoutForKeys(keys, width, height, previous = {}) {
  const out = {};
  keys.forEach((key, i) => {
    const prev = previous[key];
    if (prev && typeof prev.x === 'number' && typeof prev.y === 'number') {
      const pw = Number(prev.fontWeight);
      out[key] = {
        x: prev.x,
        y: prev.y,
        fontSize: Math.max(8, Number(prev.fontSize) || 16),
        fontWeight: Number.isFinite(pw) ? Math.min(900, Math.max(300, Math.round(pw / 100) * 100)) : 400,
        align: prev.align === 'left' ? 'left' : 'center',
        fontFamily: prev.fontFamily || 'Segoe UI',
      };
      return;
    }
    const [fx, fy] = SPREAD_FRAC[i % SPREAD_FRAC.length];
    const std = STANDARD_FIELDS[key];
    const fontSize = std ? std.defaultSize(height) : Math.max(12, Math.round(height * 0.02));
    out[key] = {
      x: Math.round(width * fx),
      y: Math.round(height * fy),
      fontSize,
      fontWeight: 400,
      align: 'center',
      fontFamily: 'Segoe UI',
    };
  });
  return out;
}

function buildFieldLabels(fieldOrder, customFieldsMeta) {
  const labels = {};
  const meta = Array.isArray(customFieldsMeta) ? customFieldsMeta : [];
  fieldOrder.forEach((key) => {
    if (STANDARD_FIELDS[key]) {
      labels[key] = STANDARD_FIELDS[key].label;
    } else {
      const c = meta.find((m) => m && m.key === key);
      labels[key] = (c && c.label) || key;
    }
  });
  return labels;
}

function previewSampleForKey(key) {
  if (STANDARD_FIELDS[key]) return STANDARD_FIELDS[key].preview;
  return 'Texto exemplo';
}

module.exports = {
  STANDARD_FIELDS,
  STANDARD_KEYS,
  sanitizeFieldKey,
  buildLayoutForKeys,
  buildFieldLabels,
  scaleLayoutProportionally,
  previewSampleForKey,
};
