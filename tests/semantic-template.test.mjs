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



const duplicateReferenceField = `Question?\n\n## Metadata\nTYPE: semantic\n\n## Semantic Answer\nREFERENCE: First answer.\nREFERENCE: Second answer.`;
assert.throws(() => parseTemplate(duplicateReferenceField), /defined more than once/i);

const unsupportedSemanticField = `Question?\n\n## Metadata\nTYPE: semantic\n\n## Semantic Answer\nREFERENCE: Valid answer.\nREFERENCES: Invalid field.`;
assert.throws(() => parseTemplate(unsupportedSemanticField), /Unsupported Semantic Answer field REFERENCES/i);

console.log('Semantic template tests passed.');

const semanticMultipleTasks = `Răspundeți separat la ambele cerințe.

A) Cum influențează asociativitatea rata de hit?
B) Ce compromis hardware introduce o asociativitate mai mare?

## Metadata
TITLE: Asociativitatea cache-ului — două sarcini
TYPE: multiple-tasks
LANGUAGE: ro

## Semantic Answers

TASK_A:
LABEL: A) Influența asupra ratei de hit
REFERENCE: |
  O asociativitate mai mare reduce ratările de conflict și crește, în general, rata de hit.
STRICTNESS: moderate
ESSENTIAL_CONCEPTS:
  - reduce ratările de conflict
  - crește rata de hit

TASK_B:
LABEL: B) Compromisul hardware
REFERENCE: |
  O asociativitate mai mare necesită mai multe comparatoare și logică de selecție, ceea ce crește costul și poate mări timpul de acces.
STRICTNESS: strict
KNOWN_INCORRECT_CLAIMS:
  - Asociativitatea mai mare nu are niciun cost hardware.

## Feedback
HINT: Răspundeți separat la A și B.`;

const multiParsed = parseTemplate(semanticMultipleTasks);
assert.equal(multiParsed.semantic, true);
assert.equal(multiParsed.semanticMultipleTasks, true);
assert.equal(multiParsed.semanticAnswers.length, 2);
assert.equal(multiParsed.answerConfigs.length, 2);
assert.deepEqual(multiParsed.answerConfigs[0].essentialConcepts, ['reduce ratările de conflict', 'crește rata de hit']);

const multiInstance = instantiateTemplate(semanticMultipleTasks, { seed: 77 });
assert.equal(multiInstance.kind, 'semantic');
assert.equal(multiInstance.semanticMultipleTasks, true);
assert.equal(multiInstance.answers.length, 2);
assert.equal(multiInstance.answers[0].validationKind, 'semantic');
assert.equal(multiInstance.answers[1].semanticConfig.strictness, 'strict');
assert.match(multiInstance.answers[0].answer, /ratările de conflict/);
assert.match(multiInstance.answers[1].answer, /comparatoare/);

const multiReport = validateTemplate(semanticMultipleTasks, { runs: 5 });
assert.equal(multiReport.valid, true, multiReport.issues.map(item => item.message).join('\n'));
assert.equal(multiReport.trials.successes, 5);

const compilerOptimizations = `La ce se referă următoarele optimizări aplicate de compilator, pentru ce sunt implementate și ce afectează?

a) Loop Interchange
b) Loop Fusion
c) Merging Arrays

## Metadata
TITLE: Optimizări ale Compilatorului pentru Memorie și Bucle
SUBJECT: Arhitectura Calculatoarelor
TOPIC: Compilatoare și Optimizarea Localității Memoriei
TYPE: multiple-tasks
DIFFICULTY: medium
SEED: random
TAGS: compiler, loop-interchange, loop-fusion, merging-arrays, localitate, cache, overhead
LANGUAGE: ro

## Semantic Answers

TASK_LOOP_INTERCHANGE:
LABEL: a) Loop Interchange
REFERENCE: |
  Loop Interchange (inversarea buclelor imbricate) reprezintă schimbarea ordinii de execuție a două bucle imbricate fără a modifica logica programului.
  Este implementată în parcurgerea de matrici/tablouri multidimensionale.
  Îmbunătățește localitatea spațială prin accesarea contiguă a memoriei și reduce drastic ratările în cache.
STRICTNESS: moderate
ESSENTIAL_CONCEPTS:
  - Schimbarea ordinii de execuție a două bucle imbricate fără modificarea logicii.
  - Îmbunătățirea localității spațiale (prin accesarea contiguă a memoriei).
  - Reducerea ratărilor în cache (cache misses).

TASK_LOOP_FUSION:
LABEL: b) Loop Fusion
REFERENCE: |
  Loop Fusion (fuziunea buclelor) reprezintă combinarea a două sau mai multe bucle succesive care parcurg același interval de iterații într-o singură buclă.
  Este implementată pentru a reduce supraîncărcarea (overhead-ul) buclelor și pentru a reutiliza datele deja încărcate în registre sau în cache.
  Îmbunătățește localitatea temporală, reduce numărul de instrucțiuni de salt și a incrementării contorului de buclă.
STRICTNESS: moderate

TASK_MERGING_ARRAYS:
LABEL: c) Merging Arrays
REFERENCE: |
  Merging Arrays (comasarea tablourilor) reprezintă reorganizarea structurii de date prin combinarea a două sau mai multe tablouri separate, care sunt accesate frecvent împreună cu același indice, într-un singur tablou.
  Este implementată pentru a forța stocarea contiguă în memorie a elementelor legate logic.
  Îmbunătățește localitatea spațială.
STRICTNESS: moderate`;

const compilerParsed = parseTemplate(compilerOptimizations);
assert.equal(compilerParsed.semanticAnswers.length, 3);
const compilerInstance = instantiateTemplate(compilerOptimizations, { seed: 123 });
assert.equal(compilerInstance.answers.length, 3);
assert.match(compilerInstance.answers[0].semanticConfig.referenceAnswer, /Loop Interchange/);
assert.match(compilerInstance.answers[1].semanticConfig.referenceAnswer, /Loop Fusion/);
assert.match(compilerInstance.answers[2].semanticConfig.referenceAnswer, /Merging Arrays/);
const compilerReport = validateTemplate(compilerOptimizations, { runs: 5 });
assert.equal(compilerReport.valid, true, compilerReport.issues.map(item => item.message).join('\n'));
