import assert from 'node:assert/strict';
import {
  buildConceptExtractionPrompt,
  buildSemanticEvaluationPrompt,
  isSemanticExercise,
  normalizeSemanticConfig,
  normalizeSemanticEvaluation,
  normalizeStrictness
} from '../assets/js/features/semantic-exercise.js';
import { normalizeText } from '../assets/js/core/utils.js';

assert.equal(normalizeStrictness('strict'), 'strict');
assert.equal(normalizeStrictness('unknown'), 'moderate');
assert.equal(normalizeText('Membrană celulară'), normalizeText('Membrana celulara'));
assert.equal(normalizeText('Știință și învățare'), 'stiinta si invatare');

const config = normalizeSemanticConfig({
  strictness: 'exacting',
  referenceAnswer: 'Membrana controlează schimburile.',
  essentialConcepts: ['controlul schimburilor'],
  acceptedExpressions: ['membrană plasmatică']
});
assert.equal(config.strictness, 'exacting');
assert.deepEqual(config.essentialConcepts, ['controlul schimburilor']);
assert.equal(config.referenceAnswer, 'Membrana controlează schimburile.');

const exercise = {
  type: 'semantic',
  validationKind: 'semantic',
  language: 'ro',
  question: 'Care este rolul membranei celulare?',
  answer: 'Membrana delimitează celula și controlează schimburile cu mediul.',
  semanticConfig: config
};
assert.equal(isSemanticExercise(exercise), true);
assert.equal(isSemanticExercise({ type: 'single-answer' }), false);

const evaluationPrompt = buildSemanticEvaluationPrompt({
  exercise,
  learnerAnswer: 'Controlează substanțele care intră și ies.'
});
assert.match(evaluationPrompt, /Respond in Romanian/);
assert.match(evaluationPrompt, /Strictness: exacting/);
assert.match(evaluationPrompt, /authoritative reference answer/i);
assert.match(evaluationPrompt, /controlul schimburilor/);

const extractionPrompt = buildConceptExtractionPrompt({
  question: exercise.question,
  referenceAnswer: exercise.answer,
  language: 'ro'
});
assert.match(extractionPrompt, /Write every returned phrase in Romanian/);
assert.match(extractionPrompt, /knownIncorrectClaims/);

const evaluation = normalizeSemanticEvaluation({
  gradable: true,
  correct: true,
  score: 1.4,
  coveredConcepts: ['schimburi'],
  feedback: 'Corect.'
}, 'ro');
assert.equal(evaluation.correct, true);
assert.equal(evaluation.score, 1);
assert.deepEqual(evaluation.coveredConcepts, ['schimburi']);
assert.equal(evaluation.message, 'Corect.');

console.log('Semantic exercise tests passed.');
