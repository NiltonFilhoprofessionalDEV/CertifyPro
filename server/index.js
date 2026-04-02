const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { loadImage } = require('canvas');

const config = require('./config');
const {
  createSession,
  getSession,
  updateSession,
  defaultLayout,
} = require('./sessions');
const { sanitizeFontFamily } = require('./fonts');
const {
  sanitizeFieldKey,
  buildLayoutForKeys,
  buildFieldLabels,
  scaleLayoutProportionally,
  previewSampleForKey,
} = require('./fields');
const { parseAndValidateCsv } = require('./csvService');
const { pdfToPngBuffer, renderPdfFirstPage } = require('./pdfRender');
const {
  createJob,
  getJob,
  subscribe,
  unsubscribe,
  runGeneration,
  replayEvents,
} = require('./jobs');
const { ensureWebFonts } = require('./webfontsInstall');
const { registerWebFonts } = require('./registerWebFonts');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

async function ensureUploadRoot() {
  await fs.mkdir(config.UPLOAD_DIR, { recursive: true });
}

function sanitizeFontWeight(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 400;
  return Math.min(900, Math.max(300, Math.round(n / 100) * 100));
}

const uploadTemplate = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const ok = ['.png', '.jpg', '.jpeg', '.pdf'].includes(ext);
    cb(null, ok);
  },
});

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, ext === '.csv');
  },
});

app.post('/api/session', async (_req, res) => {
  try {
    const session = await createSession();
    res.json({ sessionId: session.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** Verifica se a sessão ainda existe (útil após reinício do servidor ou refresh com ID salvo). */
app.get('/api/session/:sessionId', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Sessão não encontrada.' });
    return;
  }
  res.json({ ok: true, sessionId: session.id });
});

app.post('/api/session/:sessionId/template', uploadTemplate.single('template'), async (req, res) => {
  try {
    const session = getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Sessão não encontrada.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Envie o arquivo do modelo (PNG, JPG ou PDF).' });
      return;
    }

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const isPdf = ext === '.pdf';
    const templateName = isPdf ? 'template.pdf' : `template${ext || '.png'}`;
    const templatePath = path.join(session.dir, templateName);
    await fs.writeFile(templatePath, req.file.buffer);

    let width;
    let height;
    let previewFile = null;

    if (isPdf) {
      const pngBuf = await pdfToPngBuffer(req.file.buffer);
      previewFile = 'preview.png';
      await fs.writeFile(path.join(session.dir, previewFile), pngBuf);
      const { width: w, height: h } = await renderPdfFirstPage(req.file.buffer);
      width = w;
      height = h;
    } else {
      const img = await loadImage(req.file.buffer);
      width = img.width;
      height = img.height;
    }

    const prevW = session.width;
    const prevH = session.height;
    const prevLayout = session.layout;
    const canPreserve =
      prevW > 0 &&
      prevH > 0 &&
      Array.isArray(session.fieldOrder) &&
      session.fieldOrder.length > 0 &&
      prevLayout &&
      typeof prevLayout === 'object' &&
      Object.keys(prevLayout).length > 0;

    let fieldOrder;
    let layout;
    let fieldLabels;
    let customFieldsMeta;
    let csvRows;

    if (canPreserve) {
      fieldOrder = [...session.fieldOrder];
      customFieldsMeta = Array.isArray(session.customFieldsMeta)
        ? session.customFieldsMeta.map((m) => ({ key: m.key, label: m.label }))
        : [];
      const scaledPrev = scaleLayoutProportionally(prevLayout, prevW, prevH, width, height);
      layout = buildLayoutForKeys(fieldOrder, width, height, scaledPrev);
      fieldLabels = buildFieldLabels(fieldOrder, customFieldsMeta);
      csvRows = session.csvRows;
    } else {
      fieldOrder = ['nome'];
      customFieldsMeta = [];
      layout = defaultLayout(width, height);
      fieldLabels = buildFieldLabels(fieldOrder, []);
      csvRows = null;
    }

    updateSession(session.id, {
      templatePath,
      templateType: isPdf ? 'pdf' : 'image',
      width,
      height,
      previewUrl: isPdf ? `/uploads/${session.id}/${previewFile}` : `/uploads/${session.id}/${templateName}`,
      layout,
      fieldOrder,
      fieldLabels,
      customFieldsMeta,
      csvRows,
    });

    res.json({
      templateType: isPdf ? 'pdf' : 'image',
      width,
      height,
      previewUrl: `/uploads/${session.id}/${isPdf ? previewFile : templateName}`,
      layout,
      fieldOrder,
      fieldLabels,
      customFields: customFieldsMeta,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Falha ao processar modelo.' });
  }
});

const RESERVED_KEYS = new Set(['nome', 'cpf', 'data', 'curso', 'horas']);

app.post('/api/session/:sessionId/field-config', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Sessão não encontrada.' });
    return;
  }
  if (!session.width || !session.height) {
    res.status(400).json({ error: 'Envie o modelo do certificado primeiro.' });
    return;
  }
  const { enabledStandard = [], customFields = [] } = req.body || {};
  const keys = ['nome'];
  const allow = new Set(['cpf', 'data', 'curso', 'horas']);
  for (const k of enabledStandard) {
    if (allow.has(k) && !keys.includes(k)) keys.push(k);
  }
  const meta = [];
  const seen = new Set(keys);
  for (const c of customFields) {
    if (meta.length >= 10) break;
    const key = sanitizeFieldKey(c.key || c.label);
    if (!key || RESERVED_KEYS.has(key) || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    meta.push({ key, label: String(c.label || key).slice(0, 48) });
  }
  const layout = buildLayoutForKeys(keys, session.width, session.height, session.layout || {});
  const fieldLabels = buildFieldLabels(keys, meta);
  updateSession(session.id, {
    fieldOrder: keys,
    fieldLabels,
    customFieldsMeta: meta,
    layout,
    csvRows: null,
  });
  res.json({ ok: true, fieldOrder: keys, fieldLabels, layout, customFields: meta });
});

app.post('/api/session/:sessionId/layout', (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Sessão não encontrada.' });
    return;
  }
  if (!session.width || !session.height) {
    res.status(400).json({ error: 'Envie o modelo do certificado antes de salvar o layout.' });
    return;
  }
  const order = session.fieldOrder;
  if (!order || !order.length) {
    res.status(400).json({ error: 'Defina os campos (lista) antes de posicionar.' });
    return;
  }
  const body = req.body || {};
  const layout = {};
  for (const key of order) {
    const raw = body[key];
    if (!raw || raw.x === undefined || raw.y === undefined) {
      res.status(400).json({ error: `Campo "${key}": posição ou estilo incompleto.` });
      return;
    }
    layout[key] = {
      x: Number(raw.x),
      y: Number(raw.y),
      fontSize: Math.max(8, Math.min(200, Number(raw.fontSize) || 16)),
      fontWeight: sanitizeFontWeight(raw.fontWeight),
      align: raw.align === 'left' ? 'left' : 'center',
      fontFamily: sanitizeFontFamily(raw.fontFamily),
    };
  }
  updateSession(session.id, { layout });
  res.json({ ok: true, layout });
});

app.post('/api/session/:sessionId/csv', uploadCsv.single('csv'), async (req, res) => {
  try {
    const session = getSession(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Sessão não encontrada.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Envie um arquivo CSV.' });
      return;
    }

    const csvPath = path.join(session.dir, 'participantes.csv');
    await fs.writeFile(csvPath, req.file.buffer);
    const result = await parseAndValidateCsv(csvPath, session);

    if (result.ok) {
      updateSession(session.id, { csvRows: result.rows, csvPath });
    } else {
      updateSession(session.id, { csvRows: null, csvPath });
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/session/:sessionId/preview-pdf', async (req, res) => {
  try {
    const session = getSession(req.params.sessionId);
    if (!session || !session.templatePath || !session.layout) {
      res.status(400).json({ error: 'Modelo ou layout ausente.' });
      return;
    }
    const { buildCertificatePdfBuffer } = require('./certificate');
    const order = session.fieldOrder || Object.keys(session.layout);
    const sampleRow = {};
    for (const k of order) {
      sampleRow[k] = previewSampleForKey(k);
    }
    if (sampleRow.nome) sampleRow.nome = 'Nome Exemplo da Silva';
    if (sampleRow.cpf) sampleRow.cpf = '12345678901';
    const buf = await buildCertificatePdfBuffer(session, sampleRow);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename=preview.pdf');
    res.send(buf);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/session/:sessionId/generate', async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Sessão não encontrada.' });
    return;
  }
  if (!session.csvRows || !session.csvRows.length) {
    res.status(400).json({ error: 'Valide um CSV antes de gerar.' });
    return;
  }

  const job = createJob();
  res.json({ jobId: job.id });

  setImmediate(() => runGeneration(job.id, session.id));
});

app.get('/api/jobs/:jobId/progress', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  subscribe(job.id, res);
  replayEvents(job, res);

  req.on('close', () => {
    unsubscribe(job.id, res);
  });
});

app.get('/api/download/:jobId', async (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job || job.status !== 'complete' || !job.zipPath) {
    res.status(404).send('Arquivo não disponível.');
    return;
  }
  res.download(job.zipPath, 'certificados.zip', (err) => {
    if (err) console.error(err);
  });
});

app.use('/uploads', express.static(config.UPLOAD_DIR));

app.use(express.static(path.join(__dirname, '..', 'public')));

Promise.all([ensureUploadRoot(), ensureWebFonts()]).then(() => {
  registerWebFonts();
  const server = app.listen(config.PORT, () => {
    console.log(`CertifyPro em http://localhost:${config.PORT}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Porta ${config.PORT} já em uso. Feche a outra instância (ou a aba do terminal) ou use outra porta, ex.: $env:PORT=3001 (PowerShell) / set PORT=3001 (cmd) antes de npm start.`,
      );
    } else {
      console.error(err);
    }
    process.exit(1);
  });
});
