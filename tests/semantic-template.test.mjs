import assert from 'node:assert/strict';
import {
  instantiateTemplate,
  isSemanticTemplate,
  parseTemplate
} from '../assets/js/features/template-engine.js';
import { validateTemplate } from '../assets/js/features/template-validator.js';

const fixedSemantic = `Cum influențează asociativitatea cache-ului rata de hit?

## Metadata
TITLE: Asociativitatea cache-ului
TYPE: semantic
LANGUAGE: ro

## Semantic Answer
REFERENCE: |
  O asociativitate mai mare permite unui bloc mai multe poziții posibile în cache.
  Acest lucru reduce miss-urile de conflict și crește de regulă rata de hit.
STRICTNESS: moderate

## Feedback
HINT: Analizează miss-urile de conflict.`;

const parsed = parseTemplate(fixedSemantic);
assert.equal(parsed.semantic, true);
assert.equal(parsed.definitions.length, 0);
assert.equal(parsed.assignments.length, 0);
assert.equal(isSemanticTemplate(parsed), true);

const instance = instantiateTemplate(parsed, { seed: 12 });
assert.equal(instance.kind, 'semantic');
assert.equal(instance.validationKind, 'semantic');
assert.match(instance.answer, /mai multe poziții posibile/);
assert.match(instance.answer, /miss-urile de conflict/);
assert.equal(instance.semanticConfig.strictness, 'moderate');
assert.equal(instance.seed, 12);

const report = validateTemplate(fixedSemantic, { runs: 10 });
assert.equal(report.valid, true);
assert.equal(report.trials.successes, 10);
assert.equal(report.trials.minimumAnswer, null);

const randomizedSemantic = `Explică diferența dintre {FIRST} și {SECOND}.

## Metadata
TYPE: comparison
LANGUAGE: ro
SEED: 42

## Definitions
PAIR: pereche de concepte (proces și fir, compilator și interpretor)

## Mappings
FIRST: PAIR
proces și fir=proces
compilator și interpretor=compilator

SECOND: PAIR
proces și fir=fir de execuție
compilator și interpretor=interpretor

REFERENCE_TEXT: PAIR
proces și fir=Un proces are un spațiu de adrese propriu, iar firele aceluiași proces partajează în mod obișnuit memoria procesului.
compilator și interpretor=Un compilator traduce programul înaintea executării, iar un interpretor îl traduce sau îl execută în timpul rulării.

## Semantic Answer
REFERENCE: {REFERENCE_TEXT}
STRICTNESS: strict`;

const randomA = instantiateTemplate(randomizedSemantic);
const randomB = instantiateTemplate(randomizedSemantic);
assert.equal(randomA.question, randomB.question);
assert.equal(randomA.answer, randomB.answer);
assert.equal(randomA.seed, 42);
assert.equal(randomA.semanticConfig.strictness, 'strict');

console.log('Semantic template tests passed.');
