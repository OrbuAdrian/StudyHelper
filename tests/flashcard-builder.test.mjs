import assert from 'node:assert/strict';
import {
  buildFlashcardGenerationPrompt,
  buildQuestionFlashcardEvaluationPrompt,
  evaluateOptionFlashcard,
  normalizeGeneratedFlashcardSet,
  normalizeQuestionFlashcardEvaluation,
  splitReferenceIntoPhraseUnits,
  validateFlashcardSourceCoverage
} from '../assets/js/features/flashcard-builder.js';


const phraseUnits = splitReferenceIntoPhraseUnits(`First fact. Second fact!
Third fact?`, 'source-a');
assert.deepEqual(phraseUnits.map(item => item.sourceKey), ['source-a:P1', 'source-a:P2', 'source-a:P3']);
assert.equal(phraseUnits[1].text, 'Second fact!');

const coverage = validateFlashcardSourceCoverage([
  { sourceKeys: ['source-a:P1', 'source-a:P2'] },
  { sourceKeys: ['source-a:P3'] }
], phraseUnits);
assert.equal(coverage.covered.size, 3);
assert.throws(() => validateFlashcardSourceCoverage([{ sourceKeys: ['source-a:P1'] }], phraseUnits), /omitted 2/);


const sources = [{
  sourceKey: 'template-1:TASK_A',
  templateName: 'Cache associativity',
  language: 'en',
  question: 'How does cache associativity affect the hit rate?',
  taskLabel: 'Associativity effect',
  referenceAnswer: 'Increasing associativity reduces conflict misses and usually raises the hit rate.',
  strictness: 'moderate'
}];

const questionPrompt = buildFlashcardGenerationPrompt({
  title: 'Cache review',
  type: 'question',
  sources
});
assert.match(questionPrompt, /may produce several flashcards/i);
assert.match(questionPrompt, /context-dependent statements/i);
assert.match(questionPrompt, /expected answer/i);
assert.match(questionPrompt, /template-1:TASK_A/);

const questionSet = normalizeGeneratedFlashcardSet({
  title: 'Cache review',
  flashcards: [{
    type: 'question',
    front: 'Which miss type is reduced by greater cache associativity?',
    expectedAnswer: 'Conflict misses',
    gradingReference: sources[0].referenceAnswer,
    options: [],
    explanation: 'More possible placements reduce mapping conflicts.',
    language: 'en',
    sourceKeys: ['template-1:TASK_A']
  }]
}, { type: 'question', idFactory: () => 'card-q' });
assert.equal(questionSet.flashcards[0].id, 'card-q');
assert.equal(questionSet.flashcards[0].expectedAnswer, 'Conflict misses');

const evaluationPrompt = buildQuestionFlashcardEvaluationPrompt({
  card: questionSet.flashcards[0],
  learnerAnswer: 'conflict miss'
});
assert.match(evaluationPrompt, /Judge meaning, not exact wording/i);
assert.match(evaluationPrompt, /conflict miss/);

const evaluation = normalizeQuestionFlashcardEvaluation({
  gradable: true,
  correct: true,
  score: 0.95,
  feedback: 'Correct.'
});
assert.equal(evaluation.correct, true);
assert.equal(evaluation.score, 0.95);

const optionSet = normalizeGeneratedFlashcardSet({
  flashcards: [{
    type: 'option',
    front: 'Greater cache associativity primarily reduces ____.',
    expectedAnswer: 'conflict misses',
    options: ['capacity misses', 'conflict misses', 'compulsory misses'],
    explanation: 'More placements reduce conflicts.',
    language: 'en',
    sourceKeys: ['template-1:TASK_A']
  }]
}, { type: 'option', title: 'Options', idFactory: () => 'card-o' });
assert.equal(evaluateOptionFlashcard(optionSet.flashcards[0], 'conflict misses').correct, true);
assert.equal(evaluateOptionFlashcard(optionSet.flashcards[0], 'capacity misses').correct, false);

assert.throws(() => normalizeGeneratedFlashcardSet({ flashcards: [{
  type: 'option',
  front: 'No blank here.',
  expectedAnswer: 'answer',
  options: ['answer', 'wrong', 'other']
}] }, { type: 'option' }), /exactly one/);

assert.throws(() => normalizeGeneratedFlashcardSet({ flashcards: [{
  type: 'option',
  front: 'The answer is ____.',
  expectedAnswer: 'answer',
  options: ['answer', 'Answer', 'other']
}] }, { type: 'option' }), /duplicate options/);

console.log('Flashcard builder tests passed.');
