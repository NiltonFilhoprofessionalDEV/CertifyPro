const https = require('https');
const fs = require('fs');
const path = require('path');
const { loadManifest } = require('./registerWebFonts');

function downloadFile(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location;
          if (!loc) {
            reject(new Error('Redirect sem Location'));
            return;
          }
          downloadFile(loc).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      })
      .on('error', reject);
  });
}

async function ensureWebFonts() {
  const dir = path.join(__dirname, 'webfonts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const manifest = loadManifest();
  for (const entry of manifest) {
    const { url, file } = entry;
    if (!url || !file) continue;
    const dest = path.join(dir, file);
    try {
      const st = fs.statSync(dest);
      if (st.size > 5000) continue;
    } catch {
      /* ausente */
    }
    try {
      const buf = await downloadFile(url);
      fs.writeFileSync(dest, buf);
      console.log(`[webfonts] Salvo ${file}`);
    } catch (e) {
      console.warn(`[webfonts] Não foi possível baixar ${file}:`, e.message);
    }
  }
}

module.exports = { ensureWebFonts };
