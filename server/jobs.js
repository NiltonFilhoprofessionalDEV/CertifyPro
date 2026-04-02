const { v4: uuidv4 } = require('uuid');
const archiver = require('archiver');
const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const { getSession } = require('./sessions');
const { buildCertificatePdfBuffer, sanitizeFileName } = require('./certificate');

const jobs = new Map();

function createJob() {
  const id = uuidv4();
  jobs.set(id, {
    id,
    status: 'pending',
    progress: 0,
    total: 0,
    message: '',
    zipPath: null,
    error: null,
    subscribers: new Set(),
    /** @type {Array<{event:string,data:object}>} */
    eventLog: [],
  });
  return jobs.get(id);
}

function getJob(id) {
  return jobs.get(id) || null;
}

function subscribe(jobId, res) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job.subscribers.add(res);
  return true;
}

function unsubscribe(jobId, res) {
  const job = jobs.get(jobId);
  if (job) job.subscribers.delete(res);
}

function emit(job, event, data) {
  job.eventLog.push({ event, data });
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const r of job.subscribers) {
    try {
      r.write(payload);
    } catch (_) {
      job.subscribers.delete(r);
    }
  }
}

function replayEvents(job, res) {
  for (const { event, data } of job.eventLog) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    try {
      res.write(payload);
    } catch (_) {
      break;
    }
  }
}

async function runGeneration(jobId, sessionId) {
  const job = jobs.get(jobId);
  const session = getSession(sessionId);
  if (!job || !session) {
    if (job) {
      job.status = 'error';
      job.error = 'Sessão inválida.';
      emit(job, 'fail', { message: job.error });
    }
    return;
  }

  if (!session.templatePath || !session.layout) {
    job.status = 'error';
    job.error = 'Modelo ou layout não configurado.';
    emit(job, 'fail', { message: job.error });
    return;
  }

  if (!session.csvRows || !session.csvRows.length) {
    job.status = 'error';
    job.error = 'Nenhum dado CSV válido.';
    emit(job, 'fail', { message: job.error });
    return;
  }

  const rows = session.csvRows;
  job.total = rows.length;
  job.status = 'running';
  job.progress = 0;
  emit(job, 'start', { total: job.total });

  const zipPath = path.join(session.dir, `certificados-${jobId}.zip`);
  const out = require('fs').createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(out);

  const usedNames = new Map();

  try {
    let done = 0;
    for (let i = 0; i < rows.length; i += config.BATCH_SIZE) {
      const chunk = rows.slice(i, i + config.BATCH_SIZE);
      for (const row of chunk) {
        const pdfBuf = await buildCertificatePdfBuffer(session, row);
        let base = sanitizeFileName(row.nome);
        const count = (usedNames.get(base) || 0) + 1;
        usedNames.set(base, count);
        const fileName =
          count > 1 ? `certificado-${base}-${count}.pdf` : `certificado-${base}.pdf`;
        archive.append(pdfBuf, { name: fileName });
        done += 1;
        job.progress = done;
        emit(job, 'progress', { current: done, total: job.total });
      }
    }

    await archive.finalize();
    await new Promise((resolve, reject) => {
      out.on('finish', resolve);
      out.on('error', reject);
    });

    job.status = 'complete';
    job.zipPath = zipPath;
    emit(job, 'complete', { downloadUrl: `/api/download/${jobId}` });
  } catch (e) {
    job.status = 'error';
    job.error = e.message || 'Falha na geração.';
    emit(job, 'fail', { message: job.error });
    try {
      await archive.abort();
    } catch (_) {
      /* ignore */
    }
  }
}

function cleanupJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  jobs.delete(jobId);
  if (job.zipPath) {
    fs.unlink(job.zipPath).catch(() => {});
  }
}

module.exports = {
  createJob,
  getJob,
  subscribe,
  unsubscribe,
  runGeneration,
  cleanupJob,
  replayEvents,
};
