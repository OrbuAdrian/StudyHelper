import assert from 'node:assert/strict';
import { MULTIPLE_CHOICE_TEMPLATE_EXAMPLE } from '../assets/js/core/config.js';
import { instantiateTemplate, parseTemplate } from '../assets/js/features/template-engine.js';
import { validateTemplate } from '../assets/js/features/template-validator.js';

const parsed = parseTemplate(MULTIPLE_CHOICE_TEMPLATE_EXAMPLE);
assert.equal(parsed.metadata.TYPE, 'multiple-choice');
assert.equal(parsed.multipleChoice, true);
assert.equal(parsed.choices.distractorExpressions.length, 3);

const first = instantiateTemplate(MULTIPLE_CHOICE_TEMPLATE_EXAMPLE, { seed: 2026 });
const second = instantiateTemplate(MULTIPLE_CHOICE_TEMPLATE_EXAMPLE, { seed: 2026 });
assert.equal(first.question, second.question);
assert.deepEqual(first.options, second.options, 'The same seed should reproduce option order.');
assert.equal(first.correctChoice, second.correctChoice);
assert.equal(first.options.length, 4);
assert.equal(new Set(first.options).size, 4, 'Generated options must be distinct.');
assert.equal(first.options.filter(option => option === first.correctChoice).length, 1);
assert.equal(first.answer, first.correctChoice);

const report = validateTemplate(MULTIPLE_CHOICE_TEMPLATE_EXAMPLE, { runs: 25 });
assert.equal(report.valid, true, report.issues.map(item => item.message).join('\n'));
assert.equal(report.trials.successes, 25);

const staticTemplate = `What is 2 + 2?\n\n## Metadata\nTYPE: multiple-choice\nSEED: 5\n\n## Choices\nCORRECT: 4\nDISTRACTOR: 0\nDISTRACTOR: 2\nSHUFFLE: true`;
const staticInstance = instantiateTemplate(staticTemplate);
assert.deepEqual(new Set(staticInstance.options), new Set(['0', '2', '4']));
assert.equal(staticInstance.correctChoice, '4');

const retryTemplate = `Choose the value of {A}.\n\n## Metadata\nTYPE: multiple-choice\nMAX_CONSTRAINT_ATTEMPTS: 10\n\n## Definitions\nA: value (1..2)\n\n## Choices\nCORRECT: A\nDISTRACTOR: 1\nDISTRACTOR: 3\nSHUFFLE: false`;
const retried = instantiateTemplate(retryTemplate, { seed: 8 });
assert.equal(retried.variables.A, 2);
assert.equal(retried.attempt, 2, 'A duplicate generated option should trigger a fresh generation attempt.');
assert.deepEqual(retried.options, ['2', '1', '3']);

const legacyTasks = `Calculate both values.\n\n## Metadata\nTYPE: multiple-answer\n\n## Definitions\nA: value (2)\n\n## Formula\nFIRST = A + 1\nSECOND = A + 2\n\n## Answers\nFIRST:\nSECOND:`;
const migrated = parseTemplate(legacyTasks);
assert.equal(migrated.metadata.TYPE, 'multiple-tasks', 'Legacy multiple-answer metadata should migrate.');
assert.equal(instantiateTemplate(legacyTasks).answers.length, 2);

const duplicateTemplate = `What is {A} + 0?\n\n## Metadata\nTYPE: multiple-choice\nMAX_CONSTRAINT_ATTEMPTS: 2\n\n## Definitions\nA: value (1)\n\n## Formula\nANSWER = A\n\n## Choices\nCORRECT: ANSWER\nDISTRACTOR: ANSWER\nSHUFFLE: false`;
const duplicateReport = validateTemplate(duplicateTemplate, { runs: 1 });
assert.equal(duplicateReport.valid, false);
assert.match(duplicateReport.issues.map(item => item.message).join('\n'), /distinct/i);

console.log('Multiple-choice template tests passed.');
