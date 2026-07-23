import { DEFAULT_TEMPLATE } from '../assets/js/core/config.js';
import { instantiateTemplate, parseTemplate } from '../assets/js/features/template-engine.js';
import { validateTemplate } from '../assets/js/features/template-validator.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const parsed = parseTemplate(DEFAULT_TEMPLATE);
assert(parsed.metadata.TITLE === 'Asynchronous serial transmission time', 'Metadata should be parsed.');
assert(parsed.definitions.find(item => item.name === 'DATA_AMOUNT').rule.step === 0.5, 'Decimal step should be parsed.');
assert(parsed.constraints.length === 6, 'Constraints should be parsed.');
assert(parsed.answerConfig.round === 2, 'Answer rounding should be parsed.');

const first = instantiateTemplate(DEFAULT_TEMPLATE, { seed: 123456 });
const second = instantiateTemplate(DEFAULT_TEMPLATE, { seed: 123456 });
assert(first.question === second.question, 'The same seed should reproduce the question.');
assert(first.answer === second.answer, 'The same seed should reproduce the answer.');
assert(first.seed === 123456 && second.seed === 123456, 'The used seed should be returned.');
assert(first.formattedAnswer.endsWith(first.answerUnit), 'The formatted answer should include its configured unit.');

for (let seed = 1; seed <= 100; seed += 1) {
  const instance = instantiateTemplate(DEFAULT_TEMPLATE, { seed });
  const amount = instance.variables.DATA_AMOUNT;
  assert(Math.abs(amount * 2 - Math.round(amount * 2)) < 1e-10, 'DATA_AMOUNT should respect the 0.5 step.');
  assert(instance.trace.constraints.every(item => item.passed), 'Every accepted instance should satisfy all constraints.');
}

const constrained = `Find {A} divided by {B}.

## Metadata
SEED: 7

## Definitions
A: numerator (1..10)
B: denominator (0..2)

## Formula
ANSWER = A / B

## Constraints
B != 0

## Answer
VALUE: ANSWER
ROUND: 3
TOLERANCE: 0.001
TOLERANCE_TYPE: absolute
EQUIVALENCE: numeric`;

const constrainedReport = validateTemplate(constrained, { runs: 50 });
assert(constrainedReport.valid, 'A satisfiable constraint should validate.');
const constrainedInstance = instantiateTemplate(constrained);
assert(constrainedInstance.variables.B !== 0, 'Constraint retries should reject a zero denominator.');
assert(constrainedInstance.seed === 7, 'A fixed metadata seed should be used automatically.');

console.log('Template format v1.1 tests passed.');
