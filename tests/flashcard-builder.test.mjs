import assert from 'node:assert/strict';
import {
  applyFlashcardReview,
  buildFlashcardGenerationPrompt,
  buildMemoFlashcardPrompt,
  buildFlashcardReviewPrompt,
  buildSupplementalFlashcardPrompt,
  attachFlashcardSourceContext,
  buildQuestionFlashcardEvaluationPrompt,
  createFlashcardGenerationBatches,
  createMemoFlashcardResponseSchema,
  createFlashcardResponseSchema,
  distributeOptionAnswerPositions,
  evaluateOptionFlashcard,
  findSimilarFlashcardPairs,
  normalizeGeneratedFlashcardSet,
  normalizeQuestionFlashcardEvaluation,
  runFlashcardBatchQueue,
  splitFlashcardGenerationBatch,
  splitNoteIntoMemoChunks,
  splitReferenceIntoPhraseUnits,
  validateSemanticFlashcardSources,
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



const schema = createFlashcardResponseSchema('option', ['source-a:P1', 'source-a:P2']);
assert.equal(Object.hasOwn(schema, 'additionalProperties'), false);
assert.equal(Object.hasOwn(schema.properties.flashcards.items, 'additionalProperties'), false);
assert.equal(Object.hasOwn(schema.properties.flashcards.items.properties.options, 'minItems'), false);
assert.equal(Object.hasOwn(schema.properties.flashcards.items.properties.sourceKeys.items, 'enum'), false);
assert.equal(schema.properties.flashcards.items.required.includes('options'), true);
const questionSchema = createFlashcardResponseSchema('question', ['source-a:P1']);
assert.equal(Object.hasOwn(questionSchema.properties.flashcards.items.properties, 'options'), false);


const batched = createFlashcardGenerationBatches([{
  sourceKey: 'long:TASK',
  question: 'Explain the topic.',
  taskLabel: 'Long task',
  referenceAnswer: 'One. Two. Three. Four. Five.',
  language: 'en'
}], { maxPhrases: 2, maxCharacters: 1000 });
assert.equal(batched.batches.length, 3);
assert.deepEqual(batched.batches.map(batch => batch.phraseSources.length), [2, 2, 1]);
const splitBatch = splitFlashcardGenerationBatch(batched.batches[0]);
assert.equal(splitBatch.length, 2);
assert.deepEqual(splitBatch.map(batch => batch.phraseSources.length), [1, 1]);

let queueCalls = 0;
const queueResult = await runFlashcardBatchQueue([batched.batches[0]], async batch => {
  queueCalls += 1;
  if (batch.phraseSources.length > 1) throw new Error('The AI response was incomplete or malformed JSON.');
  return [{ sourceKeys: batch.phraseSources.map(item => item.sourceKey) }];
});
assert.equal(queueCalls, 3);
assert.equal(queueResult.total, 2);
assert.equal(queueResult.results.length, 2);

const attached = attachFlashcardSourceContext([{
  type: 'question',
  front: 'Question?',
  expectedAnswer: 'Answer',
  gradingReference: 'Answer',
  options: [],
  explanation: '',
  language: 'en',
  sourceKeys: ['long:TASK:P1', 'long:TASK:P2']
}], batched.phraseSources);
assert.match(attached.flashcards[0].gradingReference, /One\. Two\./);

const validatedSources = validateSemanticFlashcardSources([{
  sourceKey: 'template:TASK_A',
  question: 'Question A?',
  taskLabel: 'Task A',
  referenceAnswer: 'First reference statement. Second reference statement.',
  language: 'en'
}, {
  sourceKey: 'template:TASK_B',
  question: 'Question B?',
  taskLabel: 'Task B',
  referenceAnswer: 'A separate task reference.',
  language: 'en'
}]);
assert.equal(validatedSources.sources.length, 2);
assert.equal(validatedSources.phraseSources.length, 3);
assert.throws(() => validateSemanticFlashcardSources([{
  sourceKey: 'template:TASK_A',
  question: 'Question?',
  referenceAnswer: 'Unresolved {VALUE}.'
}]), /unresolved placeholder/i);



let preservedDiagnostics = null;
try {
  await runFlashcardBatchQueue([batched.batches[2]], async () => {
    const error = new Error('Request contains an invalid argument.');
    error.flashcardDiagnostics = { batchLabel: 'Long task', parsedSources: [{ sourceKey: 'long:TASK' }] };
    throw error;
  });
} catch (error) {
  preservedDiagnostics = error.flashcardDiagnostics;
  assert.match(error.message, /Long task/);
}
assert.equal(preservedDiagnostics?.parsedSources?.[0]?.sourceKey, 'long:TASK');


const dramSet = normalizeGeneratedFlashcardSet({
  flashcards: [{
    front: 'Memoria ____ (Dynamic Random-Access Memory) trebuie reîmprospătată periodic.',
    expectedAnswer: 'DRAM',
    options: ['DRAM', 'SRAM', 'ROM'],
    explanation: 'DRAM stores bits in capacitors.',
    sourceKeys: ['dram:P1']
  }]
}, { type: 'option', language: 'ro', idFactory: () => 'dram-card' });
assert.equal(dramSet.flashcards[0].front, 'Memoria ____ trebuie reîmprospătată periodic.');
assert.equal(dramSet.flashcards[0].expectedAnswer, 'DRAM (Dynamic Random-Access Memory)');
assert.equal(dramSet.flashcards[0].options.includes('DRAM (Dynamic Random-Access Memory)'), true);
assert.doesNotThrow(() => normalizeGeneratedFlashcardSet({ flashcards: [{
  front: 'A program stores temporary data in ____ memory.',
  expectedAnswer: 'RAM',
  options: ['RAM', 'ROM', 'SSD'],
  explanation: 'RAM is volatile working memory.'
}] }, { type: 'option', language: 'en' }));


const optionCards = [
  { id: 'one', type: 'option', front: 'A ____.', expectedAnswer: 'a', options: ['a', 'b', 'c'] },
  { id: 'two', type: 'option', front: 'B ____.', expectedAnswer: 'b', options: ['b', 'c', 'd'] },
  { id: 'three', type: 'option', front: 'C ____.', expectedAnswer: 'c', options: ['c', 'd', 'e'] }
];
const firstReviewPositions = distributeOptionAnswerPositions(optionCards, { startPosition: 0 });
const secondReviewPositions = distributeOptionAnswerPositions(optionCards, { startPosition: 1 });
const thirdReviewPositions = distributeOptionAnswerPositions(optionCards, { startPosition: 2 });
assert.deepEqual(firstReviewPositions.map(card => card.options.indexOf(card.expectedAnswer)), [0, 1, 2]);
assert.deepEqual(secondReviewPositions.map(card => card.options.indexOf(card.expectedAnswer)), [1, 2, 0]);
assert.deepEqual(thirdReviewPositions.map(card => card.options.indexOf(card.expectedAnswer)), [2, 0, 1]);

const supplementalPrompt = buildSupplementalFlashcardPrompt({
  title: 'Memory review',
  type: 'question',
  template: { question: 'Explain DRAM.', tasks: [{ referenceAnswer: 'DRAM is dynamic memory.' }] },
  existingFlashcards: [{ front: 'What is DRAM?', expectedAnswer: 'Dynamic memory' }]
});
assert.match(supplementalPrompt, /between 1 and 3/i);
assert.match(supplementalPrompt, /NOT already explicitly stated/i);

const reviewPrompt = buildFlashcardReviewPrompt({
  cards: [{ id: 'r1', type: 'option', front: 'DRAM is ____ memory.', expectedAnswer: 'dynamic', options: ['dynamic', 'static', 'read-only'], language: 'en' }],
  comparisonCards: [{ id: 'r2', front: 'DRAM is ____ memory.', expectedAnswer: 'volatile' }]
});
assert.match(reviewPrompt, /too similar/i);
const reviewed = applyFlashcardReview({ reviews: [{ id: 'r1', changed: true, revisedFront: 'Which memory category describes DRAM: ____?', reason: 'Varied cue.' }] }, [{ id: 'r1', type: 'option', front: 'DRAM is ____ memory.', expectedAnswer: 'dynamic', options: ['dynamic', 'static', 'read-only'], language: 'en' }]);
assert.equal(reviewed.changedCount, 1);
assert.match(reviewed.flashcards[0].front, /Which memory category/);
const similarPairs = findSimilarFlashcardPairs([
  { id: 's1', type: 'option', front: 'DRAM is a type of ____ memory.' },
  { id: 's2', type: 'option', front: 'DRAM is a type of ____ memory.' },
  { id: 's3', type: 'question', front: 'What does DRAM mean?' }
]);
assert.equal(similarPairs.length, 1);
assert.equal(similarPairs[0].leftId, 's1');



const memoChunks = splitNoteIntoMemoChunks('First paragraph about DRAM.\n\nSecond paragraph about SRAM.', { maxCharacters: 800 });
assert.equal(memoChunks.length, 1);
const longMemoChunks = splitNoteIntoMemoChunks(`${'A'.repeat(900)}. ${'B'.repeat(900)}.`, { maxCharacters: 800 });
assert.equal(longMemoChunks.length >= 2, true);
const memoPrompt = buildMemoFlashcardPrompt({
  noteTitle: 'Memory types',
  noteContent: 'DRAM requires periodic refresh. SRAM does not require refresh.',
  language: 'en'
});
assert.match(memoPrompt, /complete direct question/i);
assert.match(memoPrompt, /3 to 5 distinct/i);
assert.match(memoPrompt, /Use only information present in the note/i);
const memoSchema = createMemoFlashcardResponseSchema();
assert.equal(memoSchema.properties.flashcards.items.required.includes('options'), true);
const memoSet = normalizeGeneratedFlashcardSet({ flashcards: [{
  front: 'Which memory type requires periodic refresh?',
  expectedAnswer: 'DRAM',
  options: ['SRAM', 'ROM', 'DRAM'],
  explanation: 'The note states that DRAM requires refresh.'
}] }, { type: 'memo', language: 'en', idFactory: () => 'memo-1' });
assert.equal(memoSet.flashcards[0].type, 'memo');
assert.equal(evaluateOptionFlashcard(memoSet.flashcards[0], 'DRAM').correct, true);
assert.throws(() => normalizeGeneratedFlashcardSet({ flashcards: [{
  front: 'DRAM requires ____.',
  expectedAnswer: 'refresh',
  options: ['refresh', 'no power', 'compilation'],
  explanation: ''
}] }, { type: 'memo' }), /full question/i);
const memoReviewPositions = distributeOptionAnswerPositions([memoSet.flashcards[0]], { startPosition: 1 });
assert.equal(memoReviewPositions[0].options.indexOf('DRAM'), 1);

console.log('Flashcard builder tests passed.');
