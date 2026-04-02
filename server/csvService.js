const { parse } = require('csv-parse/sync');
const fs = require('fs/promises');
const config = require('./config');

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\uFEFF/g, '');
}

function firstDataLine(text) {
  const withoutBom = text.replace(/^\uFEFF/, '');
  const lines = withoutBom.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (t) return t;
  }
  return '';
}

function detectDelimiter(text) {
  const line = firstDataLine(text);
  if (!line) return ',';
  const tabs = (line.match(/\t/g) || []).length;
  const semis = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  if (tabs > 0 && tabs >= semis && tabs >= commas) return '\t';
  if (semis > commas) return ';';
  return ',';
}

function parseCsvRecords(raw, delimiter) {
  return parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    delimiter,
    bom: true,
  });
}

function hasRequiredColumns(records, columnKeys) {
  if (!records.length) return false;
  const headerMap = {};
  Object.keys(records[0]).forEach((k) => {
    headerMap[normalizeHeader(k)] = k;
  });
  return columnKeys.every((col) => Boolean(headerMap[col]));
}

/**
 * @param {object} session — usa fieldOrder (colunas exigidas no CSV)
 */
async function parseAndValidateCsv(filePath, session) {
  const fieldOrder =
    session && Array.isArray(session.fieldOrder) && session.fieldOrder.length
      ? session.fieldOrder
      : ['nome'];

  const raw = await fs.readFile(filePath, 'utf8');
  let records;
  try {
    const primary = detectDelimiter(raw);
    records = parseCsvRecords(raw, primary);
    if (!hasRequiredColumns(records, fieldOrder)) {
      const fallbacks = [',', ';', '\t'].filter((d) => d !== primary);
      for (const d of fallbacks) {
        const alt = parseCsvRecords(raw, d);
        if (hasRequiredColumns(alt, fieldOrder)) {
          records = alt;
          break;
        }
      }
    }
  } catch (e) {
    return {
      ok: false,
      rows: [],
      errors: [`CSV inválido: ${e.message}`],
      warnings: [],
      preview: [],
    };
  }

  if (!records.length) {
    return {
      ok: false,
      rows: [],
      errors: ['O CSV não contém linhas de dados.'],
      warnings: [],
      preview: [],
    };
  }

  const first = records[0];
  const headerMap = {};
  Object.keys(first).forEach((k) => {
    headerMap[normalizeHeader(k)] = k;
  });

  const missing = fieldOrder.filter((col) => !headerMap[col]);
  if (missing.length) {
    const headers = Object.keys(first).join(', ');
    return {
      ok: false,
      rows: [],
      errors: [
        `Colunas obrigatórias ausentes: ${missing.join(', ')}. Colunas encontradas: ${headers}`,
      ],
      warnings: [],
      preview: records.slice(0, 15),
    };
  }

  const warnings = [];
  const limited = records.slice(0, config.MAX_CERTIFICATES);
  if (records.length > config.MAX_CERTIFICATES) {
    warnings.push(
      `O arquivo tem ${records.length} linhas; serão usadas no máximo ${config.MAX_CERTIFICATES}.`,
    );
  }

  const errors = [];
  const rows = [];

  for (let i = 0; i < limited.length; i++) {
    const r = limited[i];
    const line = i + 2;
    const row = {};
    for (const key of fieldOrder) {
      row[key] = String(r[headerMap[key]] ?? '').trim();
    }
    if (fieldOrder.includes('nome') && !row.nome) {
      errors.push(`Linha ${line}: nome vazio.`);
    }
    if (fieldOrder.includes('cpf') && !row.cpf) {
      errors.push(`Linha ${line}: CPF vazio.`);
    }
    rows.push(row);
  }

  const ok = errors.length === 0;
  return {
    ok,
    rows: ok ? rows : [],
    errors,
    warnings,
    preview: limited.slice(0, 15),
  };
}

const REQUIRED = ['nome'];

module.exports = {
  parseAndValidateCsv,
  REQUIRED,
};
