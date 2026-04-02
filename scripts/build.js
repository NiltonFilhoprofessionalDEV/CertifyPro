#!/usr/bin/env node
/**
 * Verificação pré-deploy: sintaxe JS do servidor e ficheiros críticos.
 * Uso: npm run build
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');

function walkJs(dir, acc = []) {
  let names;
  try {
    names = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of names) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules') continue;
      walkJs(p, acc);
    } else if (ent.name.endsWith('.js')) acc.push(p);
  }
  return acc;
}

const required = [
  'package.json',
  'server/index.js',
  'server/config.js',
  'server/webfonts-manifest.json',
  'public/index.html',
  'public/app.js',
];

console.log('CertifyPro — build (verificação)\n');

let failed = false;
for (const rel of required) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    console.error(`✗ Ficheiro em falta: ${rel}`);
    failed = true;
  }
}
if (failed) process.exit(1);

const serverJs = walkJs(path.join(root, 'server'));
for (const file of serverJs) {
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
    process.stdout.write('.');
  } catch {
    console.error(`\n✗ Sintaxe inválida: ${path.relative(root, file)}`);
    process.exit(1);
  }
}
console.log(`\n✓ ${serverJs.length} ficheiros .js no server/ verificados.`);

try {
  execSync('node --check "' + path.join(root, 'public', 'app.js') + '"', { stdio: 'pipe' });
  console.log('✓ public/app.js');
} catch {
  console.error('✗ public/app.js');
  process.exit(1);
}

console.log('\nBuild OK — pode executar npm start ou docker build.');
