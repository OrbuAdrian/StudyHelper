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
  'directConceptMode',
  'loadMultipleChoiceTemplateButton',
  'noteTitle',
  'noteContent',
  'saveNoteButton',
  'createMemoCardsButton',
  'flashcardNotePool',
  'generateFlashcardsButton',
  'flashcardTemplatePool',
  'expandFlashcardsButton',
  'reviewFlashcardsButton',
  'importFlashcardSetButton',
  'flashcardSetImportFile',
  'deleteAllFlashcardsButton',
  'flashcardModal'
]) assert.equal(ids.has(id), true, `Missing required control: ${id}`);

assert.match(config, /uiLanguage:\s*'en'/);
assert.match(config, /contentLanguage:\s*'en'/);
assert.match(i18n, /ro-RO/);
assert.match(app, /gradable:\s*false/);
assert.match(app, /buildSemanticEvaluationPrompt/);
assert.match(app, /buildConceptExtractionPrompt/);
assert.match(app, /score:\s*correct[\s\S]*graded,[\s\S]*ungradable/);


assert.match(app, /candidateTemplateIds/);
assert.match(app, /instantiateTemplate/);
assert.match(app, /semanticValidationMeta/);
assert.match(app, /multiple-tasks/);
assert.match(app, /options:\s*result\.options\s*\|\|\s*\[\]/);
assert.match(config, /MULTIPLE_CHOICE_TEMPLATE_EXAMPLE/);
assert.match(html, /TYPE: multiple-choice/);
assert.doesNotMatch(html, /reserved for multiple-choice template expansion/i);
assert.doesNotMatch(app, /data-action=\"quiz\"/);
assert.match(html, /choose one or more saved templates/);
assert.match(html, /## Semantic Answer/);
assert.match(html, /## Semantic Answers/);
assert.doesNotMatch(app, /Generated grading guidance/);
assert.match(app, /semanticConfig:\s*semanticTask/);
assert.match(app, /buildFlashcardGenerationPrompt/);
assert.match(app, /buildQuestionFlashcardEvaluationPrompt/);
assert.match(html, /data-view="flashcards"/);
assert.match(config, /notes:\s*\[\]/);
assert.match(config, /flashcardSets:\s*\[\]/);
assert.match(config, /savedFlashcards:\s*\[\]/);
assert.match(app, /distributeOptionAnswerPositions/);
assert.match(app, /optionReviewCycle/);
assert.match(app, /startPosition:\s*optionReviewCycle/);
assert.match(app, /buildSupplementalFlashcardPrompt/);
assert.match(app, /buildFlashcardReviewPrompt/);
assert.match(app, /importFlashcardSetFile/);
assert.match(app, /buildMemoFlashcardPrompt/);
assert.match(app, /splitNoteIntoMemoChunks/);
assert.match(html, /data-view="notes"/);
assert.match(html, /value="memo"/);
console.log('Static integration tests passed.');
