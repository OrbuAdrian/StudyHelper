import { DYNAMIC_TEMPLATE_EXAMPLE } from '../assets/js/core/config.js';
import { instantiateTemplate, parseTemplate } from '../assets/js/features/template-engine.js';
import { validateTemplate } from '../assets/js/features/template-validator.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}


const bundledDynamicReport = validateTemplate(DYNAMIC_TEMPLATE_EXAMPLE, { runs: 25 });
assert(bundledDynamicReport.valid, `The bundled dynamic example should validate: ${bundledDynamicReport.issues.map(item => item.message).join('; ')}`);
const bundledDynamic = instantiateTemplate(DYNAMIC_TEMPLATE_EXAMPLE, { seed: 31415 });
assert(bundledDynamic.answers.length === bundledDynamic.variables.MATRIX.length + 1, 'The bundled dynamic example should generate one row answer per row.');

const matrixTemplate = `Consider the generated matrix:\n\n{{matrix MATRIX}}\n\n{{#if ASK_ROWS == 1}}Calculate the sum of every row.{{else}}Calculate the sum of every column.{{/if}}\n\nGenerated rows:\n{{#each MATRIX}}Row {INDEX}: {VALUES}\n{{/each}}\n\n## Metadata\nTITLE: Dynamic matrix sums\nTYPE: multiple-answer\nSEED: random\n\n## Definitions\nASK_ROWS: selected task (1)\nNR_ROWS: row count (2..4)\nNR_COLUMNS: column count (2..5)\n\n## Collections\nMATRIX:\nTYPE: matrix\nROWS: NR_ROWS\nCOLUMNS: NR_COLUMNS\nVALUE: 0..9\n\n## Formula\nTOTAL_SUM = sum(MATRIX)\nFIRST_CELL = cell(MATRIX, 0, 0)\n\n## Answer\nVALUE: TOTAL_SUM\nLABEL: Sum of all cells\nROUND: 0\n\n## Repeated Answers\nROW_SUMS:\nSOURCE: MATRIX\nMODE: items\nVALUE: sum(VALUE)\nLABEL: Sum of row {INDEX}\nROUND: 0\n\n## Feedback\nHINT: |\n  Add the values on each generated row.\n  Keep the row order shown in the question.\n`;

const parsed = parseTemplate(matrixTemplate);
assert(parsed.collections.length === 1, 'The matrix collection should be parsed.');
assert(parsed.repeatedAnswerConfigs.length === 1, 'The repeated answer group should be parsed.');
assert(parsed.feedback.HINT.includes('\n'), 'Multiline feedback should preserve line breaks.');

const first = instantiateTemplate(matrixTemplate, { seed: 2304 });
const second = instantiateTemplate(matrixTemplate, { seed: 2304 });
assert(first.question === second.question, 'The same seed should reproduce the dynamic question.');
assert(JSON.stringify(first.variables.MATRIX) === JSON.stringify(second.variables.MATRIX), 'The same seed should reproduce every matrix cell.');
assert(first.question.includes('Calculate the sum of every row.'), 'The conditional branch should be rendered.');
assert(!first.question.includes('{{'), 'All structural directives should be resolved.');
assert(first.answers.length === first.variables.MATRIX.length + 1, 'One repeated answer should be created per matrix row.');
first.variables.MATRIX.forEach((row, index) => {
  const expected = row.reduce((total, value) => total + value, 0);
  assert(first.answers[index + 1].answer === expected, `Row ${index + 1} should have the correct repeated answer.`);
});
assert(first.answer === first.variables.MATRIX.flat().reduce((total, value) => total + value, 0), 'Collection-aware sum() should calculate the total.');

const report = validateTemplate(matrixTemplate, { runs: 25 });
assert(report.valid, `The dynamic matrix template should validate: ${report.issues.map(item => item.message).join('; ')}`);
assert(report.trials.successes === 25, 'All dynamic randomized tests should pass.');

const listTemplate = `The generated jobs are:\n{{#each JOBS}}Job {INDEX}: arrival {ARRIVAL}, duration {DURATION}\n{{/each}}\n\nCalculate the total duration.\n\n## Collections\nJOBS:\nTYPE: list\nCOUNT: 3..5\nFIELD ARRIVAL: 0..10\nFIELD DURATION: 1..8\n\n## Formula\nANSWER = sum(JOBS, "DURATION")\n\n## Answer\nVALUE: ANSWER\nROUND: 0`;

const listInstance = instantiateTemplate(listTemplate, { seed: 99 });
assert(listInstance.variables.JOBS.length >= 3 && listInstance.variables.JOBS.length <= 5, 'The list count should be generated from its range.');
assert(listInstance.question.includes('Job 1:'), 'Repeated list records should render in the question.');
assert(listInstance.answer === listInstance.variables.JOBS.reduce((total, item) => total + item.DURATION, 0), 'Field-based sum() should work for record lists.');

const repeatedOnlyTemplate = `Calculate every row sum for:\n\n{{matrix GRID}}\n\n## Collections\nGRID:\nTYPE: grid\nROWS: 2\nCOLUMNS: 3\nVALUE: 1..5\n\n## Repeated Answers\nROW_TOTALS:\nSOURCE: GRID\nMODE: items\nVALUE: sum(VALUE)\nLABEL: Row {INDEX}\nROUND: 0`;

const repeatedOnly = instantiateTemplate(repeatedOnlyTemplate, { seed: 77 });
assert(repeatedOnly.answers.length === 2, 'A repeated-answer-only template should not need a Formula section.');
assert(repeatedOnly.answer === repeatedOnly.answers[0].answer, 'The first repeated answer should become the primary answer.');
assert(validateTemplate(repeatedOnlyTemplate, { runs: 10 }).valid, 'Repeated-answer-only templates should validate.');

const semanticCollectionTemplate = `Examine the generated values:\n{{#each VALUES_LIST}}Value {INDEX}: {VALUE}\n{{/each}}\nExplain whether repeated values are possible.\n\n## Metadata\nTYPE: semantic\nLANGUAGE: en\n\n## Collections\nVALUES_LIST:\nTYPE: list\nCOUNT: 3..5\nVALUE: 1..3\n\n## Semantic Answer\nREFERENCE: |\n  Repeated values are possible because every list item is generated independently\n  from the same allowed range.\nSTRICTNESS: moderate`;

const semanticCollection = instantiateTemplate(semanticCollectionTemplate, { seed: 11 });
assert(semanticCollection.kind === 'semantic', 'Dynamic collections should work in semantic templates.');
assert(semanticCollection.question.includes('Value 1:'), 'Semantic list content should be rendered.');
assert(semanticCollection.answer.includes('\n'), 'A multiline semantic reference should preserve its line break.');

console.log('Template Format v2 dynamic-structure tests passed.');
