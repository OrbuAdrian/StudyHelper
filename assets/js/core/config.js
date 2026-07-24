export const STORAGE_KEY = 'studyForgeStateV1';
export const SESSION_KEY = 'studyForgeSessionApiKey';
export const SOURCE_LIMIT = 120000;

export const DEFAULT_TEMPLATE = `Calculate the time required in {OUTPUT_UNIT} to transmit {DATA_AMOUNT} KB of data on an asynchronous serial line configured at {BPS} bps, using {DATA_BITS} data bits, {PARITY} parity, and {STOP} stop bit(s).

## Metadata

TITLE: Asynchronous serial transmission time
SUBJECT: Computer engineering
TOPIC: Serial communication
TYPE: single-answer
DIFFICULTY: medium
SEED: random
TAGS: communication, transmission, bandwidth
LANGUAGE: en
MAX_CONSTRAINT_ATTEMPTS: 1000

## Definitions

DATA_AMOUNT: the amount of data to transmit in kilobytes (1.0..10.0; step=0.5)
BPS: the transmission speed in bits per second (200..800; step=100)
DATA_BITS: the number of data bits in one frame (5..8)
PARITY: the parity mode (even, odd, none)
STOP: the number of stop bits (1, 2)
OUTPUT_UNIT: the requested answer unit (seconds, milliseconds)

## Mappings

PARITY_BITS: PARITY
none=0
even=1
odd=1

UNIT_MULTIPLIER: OUTPUT_UNIT
seconds=1
milliseconds=1000

## Formula

START = 1
FRAME_BITS = START + DATA_BITS + PARITY_BITS + STOP
TOTAL_DATA_BITS = DATA_AMOUNT * 1024 * 8
TOTAL_FRAMES = TOTAL_DATA_BITS / DATA_BITS
TIME_SECONDS = TOTAL_FRAMES * FRAME_BITS / BPS
ANSWER = TIME_SECONDS * UNIT_MULTIPLIER

## Constraints

DATA_AMOUNT > 0
BPS > 0
DATA_BITS > 0
FRAME_BITS <= 12
ANSWER > 0
ANSWER <= 1000000

## Answer

VALUE: ANSWER
UNIT: OUTPUT_UNIT
ROUND: 2
TOLERANCE: 0.01
TOLERANCE_TYPE: absolute
EQUIVALENCE: numeric

## Feedback

HINT: Calculate the total data bits, determine the frame size, and account for every transmitted frame.
SOLUTION: Calculate FRAME_BITS, then TOTAL_FRAMES, then divide the transmitted frame bits by BPS. Finally convert the result to {OUTPUT_UNIT}.`;

export function createEmptyState() {
  return {
    source: {
      title: '',
      text: '',
      type: 'topic',
      fileName: '',
      updatedAt: null
    },
    summaries: [],
    exercises: [],
    templates: [],
    quizzes: [],
    attempts: [],
    quizDraft: [],
    currentSummary: null,
    currentExercise: null,
    settings: {
      rememberApiKey: false,
      apiKey: '',
      model: 'gemini-2.5-flash',
      validationMode: 'combined',
      numericTolerance: 0.0001,
      theme: 'light',
      uiLanguage: 'en',
      contentLanguage: 'en'
    }
  };
}

export const DYNAMIC_TEMPLATE_EXAMPLE = `Consider the following generated matrix:

{{matrix MATRIX}}

{{#if SHOW_NOTE == 1}}
All generated cell values are positive integers.
{{/if}}

The generated rows are:
{{#each MATRIX}}
Row {INDEX}: {VALUES}
{{/each}}

Complete all tasks:
1. Calculate the sum of all matrix elements.
2. Calculate the sum of every generated row.

## Metadata

TITLE: Dynamic matrix sums
SUBJECT: Mathematics
TOPIC: Matrices and aggregation
TYPE: multiple-answer
DIFFICULTY: medium
SEED: random
LANGUAGE: en
MAX_CONSTRAINT_ATTEMPTS: 1000

## Definitions

NR_ROWS: number of matrix rows (2..4)
NR_COLUMNS: number of matrix columns (3..5)
SHOW_NOTE: whether to display the additional note (0, 1)

## Collections

MATRIX:
TYPE: matrix
ROWS: NR_ROWS
COLUMNS: NR_COLUMNS
VALUE: 1..9

## Formula

TOTAL_SUM = sum(MATRIX)

## Constraints

TOTAL_SUM > 0

## Answer

VALUE: TOTAL_SUM
LABEL: Sum of all matrix elements
ROUND: 0
TOLERANCE: 0
TOLERANCE_TYPE: absolute
EQUIVALENCE: numeric

## Repeated Answers

ROW_SUMS:
SOURCE: MATRIX
MODE: items
VALUE: sum(VALUE)
LABEL: Sum of row {INDEX}
ROUND: 0
TOLERANCE: 0
TOLERANCE_TYPE: absolute
EQUIVALENCE: numeric

## Feedback

HINT: |
  Add all values for the total sum.
  Then calculate each row independently.

SOLUTION: |
  The matrix contains {NR_ROWS} rows and {NR_COLUMNS} columns.
  Add the values shown in each generated row.`;
