import {
  createQuizProblem,
  getProblemCandidates,
  normalizeQuizProblems,
  resolveQuizProblems,
  setProblemCandidates,
  validateQuizProblems
} from '../assets/js/features/quiz-blueprint.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const exercises = [
  { id: 'a', question: 'Question A', answer: 'A', type: 'single-answer' },
  { id: 'b', question: 'Question B', answer: 'B', type: 'single-answer' },
  { id: 'c', question: 'Question C', answer: 'C', type: 'single-answer' }
];

let problem = createQuizProblem([exercises[0]]);
assert(problem.candidateIds.length === 1, 'A problem should preserve its initial candidate.');
problem = setProblemCandidates(problem, ['a', 'b'], exercises);
assert(getProblemCandidates(problem, exercises).length === 2, 'A problem should allow multiple candidate exercises.');

const resolvedFirst = resolveQuizProblems([problem], exercises, () => 0)[0];
const resolvedLast = resolveQuizProblems([problem], exercises, () => 0.999)[0];
assert(resolvedFirst.id === 'a', 'Low random values should select the first candidate.');
assert(resolvedLast.id === 'b', 'High random values should select the last candidate.');

const oldDraft = normalizeQuizProblems([exercises[2]], exercises);
assert(oldDraft.length === 1 && oldDraft[0].candidateIds[0] === 'c', 'Old fixed-exercise quiz drafts should migrate to one-candidate problems.');
assert(validateQuizProblems([createQuizProblem([])], exercises).length === 1, 'Empty problem pools should be rejected.');
assert(validateQuizProblems([problem], exercises).length === 0, 'Configured problem pools should validate.');

console.log('Quiz blueprint tests passed.');
