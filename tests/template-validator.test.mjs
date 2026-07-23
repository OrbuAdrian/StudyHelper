import { DEFAULT_TEMPLATE } from '../assets/js/core/config.js';
import { instantiateTemplate } from '../assets/js/features/template-engine.js';
import { validateTemplate } from '../assets/js/features/template-validator.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const report = validateTemplate(DEFAULT_TEMPLATE, { runs: 100 });
assert(report.valid, 'The bundled example template should validate.');
assert(report.trials.successes === 100, 'All example-template test runs should pass.');

const instance = instantiateTemplate(DEFAULT_TEMPLATE);
const highlighted = instance.questionSegments.filter(
  segment => segment.type === 'value' && segment.required
);
assert(highlighted.length === 6, 'All six solution inputs, including the requested output unit, should be highlighted.');
assert(instance.trace.assignments.some(step => step.name === 'ANSWER' && step.required), 'The answer should be present in the relevant calculation trace.');

const unsafeTemplate = `Find the result using {A}.

## Definitions

A: denominator (0-1)
B: required numerator (3)

## Formula

UNUSED = 9
ANSWER = B / A`;

const unsafeReport = validateTemplate(unsafeTemplate, { runs: 100 });
const issueCodes = new Set(unsafeReport.issues.map(item => item.code));
assert(issueCodes.has('hidden-required-input'), 'A hidden required input should be reported.');
assert(issueCodes.has('unused-assignment'), 'An unused assignment should be reported.');
assert(issueCodes.has('runtime-non-finite'), 'Possible division by zero should be found by randomized trials.');

console.log('Template engine and validator tests passed.');
