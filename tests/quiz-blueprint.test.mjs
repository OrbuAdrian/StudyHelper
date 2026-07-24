import assert from 'node:assert/strict';
import {
  createQuizProblem,
  getProblemCandidates,
  normalizeQuizProblems,
  resolveQuizProblems,
  setProblemCandidates,
  validateQuizProblems
} from '../assets/js/features/quiz-blueprint.js';

const templates = [
  { id: 'ta', name: 'Template A', text: 'Question A\n\n## Definitions\nA: value (1)\n\n## Formula\nANSWER = A' },
  { id: 'tb', name: 'Template B', text: 'Question B\n\n## Definitions\nB: value (2)\n\n## Formula\nANSWER = B' }
];
const legacyExercise = { id: 'old-exercise', question: 'Old fixed question', answer: '7', type: 'single-answer' };

let problem = createQuizProblem([templates[0]]);
assert.deepEqual(problem.candidateTemplateIds, ['ta']);
problem = setProblemCandidates(problem, ['ta', 'tb'], templates);
assert.equal(getProblemCandidates(problem, templates).length, 2);

let generationNumber = 0;
const instantiateTemplate = text => ({
  kind: 'deterministic',
  metadata: {},
  question: `${text.startsWith('Question A') ? 'Question A' : 'Question B'} instance ${++generationNumber}`,
  questionSegments: [],
  answer: generationNumber,
  formattedAnswer: String(generationNumber),
  answerUnit: '',
  acceptedAnswers: [],
  answers: [],
  answerConfig: {},
  variables: {},
  requiredInputs: [],
  trace: null,
  seed: generationNumber,
  feedback: {},
  explanation: ''
});
const buildExercise = (instance, template) => ({
  id: `generated-${instance.seed}`,
  question: instance.question,
  answer: instance.formattedAnswer,
  templateSeed: instance.seed,
  sourceTemplateId: template.id
});

const first = resolveQuizProblems([problem], templates, {
  random: () => 0,
  instantiateTemplate,
  buildExercise
})[0];
const second = resolveQuizProblems([problem], templates, {
  random: () => 0,
  instantiateTemplate,
  buildExercise
})[0];
const last = resolveQuizProblems([problem], templates, {
  random: () => 0.999,
  instantiateTemplate,
  buildExercise
})[0];
assert.equal(first.sourceTemplateId, 'ta');
assert.equal(last.sourceTemplateId, 'tb');
assert.notEqual(first.question, second.question, 'Starting the quiz again should instantiate a fresh exercise.');
assert.notEqual(first.templateSeed, second.templateSeed, 'Fresh instances should retain their own generated seed.');

const migrated = normalizeQuizProblems([
  {
    id: 'old-slot',
    candidateIds: ['old-exercise'],
    candidateSnapshots: { 'old-exercise': legacyExercise }
  }
], templates, [legacyExercise]);
assert.deepEqual(migrated[0].legacyExerciseIds, ['old-exercise']);
assert.equal(getProblemCandidates(migrated[0], templates, [legacyExercise])[0].kind, 'exercise');

assert.equal(validateQuizProblems([createQuizProblem([])], templates).length, 1);
assert.equal(validateQuizProblems([problem], templates).length, 0);

console.log('Quiz template-candidate tests passed.');
