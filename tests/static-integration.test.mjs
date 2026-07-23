import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [html, app, config, i18n] = await Promise.all([
  readFile(resolve(root, 'index.html'), 'utf8'),
  readFile(resolve(root, 'assets/js/app.js'), 'utf8'),
  readFile(resolve(root, 'assets/js/core/config.js'), 'utf8'),
  readFile(resolve(root, 'assets/js/core/i18n.js'), 'utf8')
]);

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
const references = new Set([...app.matchAll(/els\.([A-Za-z0-9_]+)/g)].map(match => match[1]));
assert.deepEqual([...references].filter(id => !ids.has(id)), []);

for (const id of [
  'interfaceLanguageQuick',
  'interfaceLanguage',
  'defaultContentLanguage',
  'summaryLanguage',
  'aiExerciseLanguage',
  'directLanguage',
  'aiSemanticSettings',
  'directSemanticWrap',
  'directSemanticStrictness',
  'directConceptMode'
]) assert.equal(ids.has(id), true, `Missing required control: ${id}`);

assert.match(config, /uiLanguage:\s*'en'/);
assert.match(config, /contentLanguage:\s*'en'/);
assert.match(i18n, /ro-RO/);
assert.match(app, /gradable:\s*false/);
assert.match(app, /buildSemanticEvaluationPrompt/);
assert.match(app, /buildConceptExtractionPrompt/);
assert.match(app, /score:\s*correct[\s\S]*graded,[\s\S]*ungradable/);

console.log('Static integration tests passed.');
