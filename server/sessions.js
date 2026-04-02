const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs/promises');
const config = require('./config');
const { buildLayoutForKeys } = require('./fields');

const sessions = new Map();

/** Layout inicial só com nome; o usuário marca ou cria os demais campos. */
function defaultLayout(width, height) {
  return buildLayoutForKeys(['nome'], width, height, {});
}

async function createSession() {
  const id = uuidv4();
  const dir = path.join(config.UPLOAD_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  sessions.set(id, {
    id,
    dir,
    templatePath: null,
    templateType: null,
    width: 0,
    height: 0,
    previewUrl: null,
    layout: null,
    fieldOrder: null,
    fieldLabels: null,
    customFieldsMeta: [],
    csvRows: null,
    csvError: null,
    createdAt: Date.now(),
  });
  return sessions.get(id);
}

function getSession(id) {
  return sessions.get(id) || null;
}

function updateSession(id, patch) {
  const s = sessions.get(id);
  if (!s) return null;
  Object.assign(s, patch);
  return s;
}

async function removeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  try {
    await fs.rm(s.dir, { recursive: true, force: true });
  } catch (_) {
    /* ignore */
  }
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  removeSession,
  defaultLayout,
};
