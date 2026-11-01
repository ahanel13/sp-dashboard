#!/usr/bin/env node
// Copies sp-dashboard/i18n/en.json into the I18N_EN block of index.html.
//
// en.json is the source of truth for every UI string. Super Productivity
// serves it (and the other i18n/<lang>.json files) through PluginAPI.translate,
// but index.html also carries the English text inline so the dashboard still
// renders when that API is missing: standalone file:// development, the test
// harness, and Super Productivity versions that predate plugin translations.
//
//   node scripts/sync-i18n.js           rewrite the block from en.json
//   node scripts/sync-i18n.js --check   exit 1 if the block is out of date

import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const enPath = path.join(root, 'sp-dashboard', 'i18n', 'en.json');
const htmlPath = path.join(root, 'sp-dashboard', 'index.html');

const BEGIN = '/* I18N_EN:BEGIN';
const END = '/* I18N_EN:END */';

const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const html = fs.readFileSync(htmlPath, 'utf8');

const start = html.indexOf(BEGIN);
const end = html.indexOf(END);
if (start === -1 || end === -1 || end < start) {
  console.error(`❌ ${path.relative(root, htmlPath)} has no I18N_EN:BEGIN / I18N_EN:END block`);
  process.exit(1);
}

// Match the indentation of the BEGIN marker so the block sits naturally in the script.
const lineStart = html.lastIndexOf('\n', start) + 1;
const indent = html.slice(lineStart, start);
const body = JSON.stringify(en, null, 2).split('\n').join(`\n${indent}`);
const block =
  `${BEGIN} — generated from i18n/en.json by scripts/sync-i18n.js. Edit en.json, not this. */\n` +
  `${indent}const I18N_EN = ${body};\n` +
  `${indent}`;

const next = html.slice(0, start) + block + html.slice(end);

if (process.argv.includes('--check')) {
  if (next !== html) {
    console.error('❌ index.html is out of date with i18n/en.json — run: npm run i18n:sync');
    process.exit(1);
  }
  console.log('✅ index.html matches i18n/en.json');
  process.exit(0);
}

if (next === html) {
  console.log('✅ index.html already matches i18n/en.json');
} else {
  fs.writeFileSync(htmlPath, next);
  console.log('✅ updated the I18N_EN block in index.html from i18n/en.json');
}
