# Study Forge Template Format v2

Template Format v2 extends the original scalar-placeholder format with dynamic plain-text structures. Existing v1.1 templates remain valid.

The authoring surface is still plain text. Templates do not accept HTML, CSS, JavaScript, event handlers, or external scripts.

## Supported sections

Recommended order:

```text
Learner-facing exercise text

## Metadata
## Definitions
## Mappings
## Collections
## Formula
## Constraints
## Answer
## Answers
## Repeated Answers
## Semantic Answer
## Choices
## Feedback
```

A deterministic template needs either `## Definitions` or `## Collections`, plus either `## Formula` or `## Repeated Answers`.

A semantic template needs learner-facing text, semantic `TYPE` metadata, and `## Semantic Answer`. Definitions, mappings, collections, formulas, and constraints are optional.

## Learner-facing text

Scalar and derived values use placeholders:

```text
Find the area of a rectangle with length {LENGTH} and width {WIDTH}.
```

Dynamic structures use plain-text directives:

```text
{{matrix MATRIX}}

{{#each JOBS}}
Job {INDEX}: arrival {ARRIVAL}, duration {DURATION}
{{/each}}

{{#if ASK_FOR_MAXIMUM == 1}}
Find the largest value.
{{else}}
Find the smallest value.
{{/if}}
```

Supported directives are:

- `{{matrix NAME}}`: render a matrix as newline-separated rows.
- `{{#each NAME}} ... {{/each}}`: repeat text once per matrix row or list item.
- `{{#if EXPRESSION}} ... {{else}} ... {{/if}}`: render one conditional branch. The `else` branch is optional.

Within an `each` block, these local placeholders are available:

- `{INDEX}`: one-based item number.
- `{INDEX0}`: zero-based item number.
- `{VALUE}`: the current primitive item, row, or record.
- `{VALUES}`: the current matrix row or column.
- `{ROW_INDEX}` and `{ROW_INDEX0}` for matrix rows.
- Record field names such as `{ARRIVAL}` and `{DURATION}`.

Directives may be nested. Every opening block must have its matching closing directive.

## Metadata

Supported terms:

```text
TITLE:
SUBJECT:
TOPIC:
TYPE:
DIFFICULTY:
SEED:
TAGS:
LANGUAGE:
MAX_CONSTRAINT_ATTEMPTS:
```

`SEED` accepts `random` or an integer from `0` to `4294967295`. The same template and seed reproduce all scalar values, collection dimensions, collection items, matrix cells, constraint retries, conditional branches, and answer fields.

## Multiline values

Key-value sections support preserved multiline values with `|`:

```text
## Feedback

HINT: |
  Add the values on each row.
  Keep the original row order.

EXPLANATION: |
  The first line is part of the same explanation.
  The second line continues it.
```

The same block syntax can be used for metadata text, feedback, answer text, choices, and semantic-answer values where the relevant term supports free text.

## Definitions

Definitions generate scalar values:

```text
VARIABLE_NAME: description (value rule)
```

Examples:

```text
FIXED_INTEGER: fixed value (600)
FIXED_DECIMAL: fixed value (5.0)
FIXED_TEXT: protocol name ("UART")
INTEGER_RANGE: generated integer (5..8)
DECIMAL_RANGE: generated decimal (1.0..10.0; step=0.5)
NUMERIC_SET: selected value (1200, 2400, 4800)
TEXT_SET: selected mode (even, odd, none)
```

Ranges are inclusive. Legacy `5-8` ranges remain supported. Mixed numeric and text sets are rejected.

## Mappings

Mappings convert one generated scalar value into another value:

```text
PARITY_BITS: PARITY
none=0
even=1
odd=1
```

The source must be a scalar definition. Every possible source value should have a mapping entry.

## Collections

Collections generate structures whose size and contents can vary.

### Matrix or grid

```text
## Collections

MATRIX:
TYPE: matrix
ROWS: NR_ROWS
COLUMNS: 2..5
VALUE: 0..9
```

`TYPE: grid` is an alias for `TYPE: matrix`.

`ROWS` and `COLUMNS` may be:

- a fixed integer;
- an integer range such as `2..5`;
- a numeric set such as `2, 4, 6`;
- a scalar expression such as `NR_ROWS` or `BASE_SIZE + 1`.

`VALUE` uses the same fixed, range, stepped-range, or set syntax as a definition. Every matrix cell is generated independently from the seeded random sequence.

Render the matrix directly:

```text
{{matrix MATRIX}}
```

Or repeat a line for each row:

```text
{{#each MATRIX}}
Row {INDEX}: {VALUES}
{{/each}}
```

### Primitive list

```text
NUMBERS:
TYPE: list
COUNT: 3..7
VALUE: 1..20
```

A primitive list contains independently generated scalar values.

### Record list

```text
JOBS:
TYPE: list
COUNT: 3..6
FIELD ARRIVAL: 0..10
FIELD DURATION: 1..8
FIELD PRIORITY: 1..5
```

Each list item is a record with independently generated fields.

Render the records:

```text
{{#each JOBS}}
Job {INDEX}: arrival {ARRIVAL}, duration {DURATION}, priority {PRIORITY}
{{/each}}
```

Collection sizes are limited to 100 rows or items per collection to prevent accidental browser freezes.

## Formula

Assignments are evaluated from top to bottom:

```text
VARIABLE = EXPRESSION
```

Supported operators:

```text
+ - * / % ^ ( )
```

Supported constants:

```text
PI
E
```

Scalar functions:

```text
abs()
round()
floor()
ceil()
min()
max()
sqrt()
pow()
```

Collection functions:

```text
count(COLLECTION)
sum(COLLECTION)
sum(LIST, "FIELD")
average(COLLECTION)
average(LIST, "FIELD")
min(COLLECTION)
max(COLLECTION)
row(MATRIX, ZERO_BASED_ROW)
column(MATRIX, ZERO_BASED_COLUMN)
cell(MATRIX, ZERO_BASED_ROW, ZERO_BASED_COLUMN)
contains(COLLECTION, VALUE)
field(LIST, "FIELD")
sort(COLLECTION)
sort(LIST, "FIELD")
unique(COLLECTION)
unique(LIST, "FIELD")
```

Matrices are flattened by `sum`, `average`, `min`, and `max` when no field selector is supplied.

Examples:

```text
TOTAL = sum(MATRIX)
ROW_TOTAL = sum(row(MATRIX, SELECTED_ROW - 1))
COLUMN_MAXIMUM = max(column(MATRIX, SELECTED_COLUMN - 1))
TOTAL_DURATION = sum(JOBS, "DURATION")
UNIQUE_PRIORITIES = count(unique(JOBS, "PRIORITY"))
```

Formula assignments may produce intermediate arrays, but configured deterministic final answers must be finite numeric values.

## Constraints

Each constraint must evaluate to true:

```text
NR_ROWS >= 2
count(JOBS) >= 3
sum(JOBS, "DURATION") <= 40
cell(MATRIX, 0, 0) != 0
NOT (MODE == "hard" AND count(NUMBERS) < 5)
```

Supported comparisons:

```text
== != < <= > >=
```

Supported logical operators:

```text
AND OR NOT
```

Collections are generated before formulas and constraints. A rejected attempt advances the deterministic seeded sequence and generates a complete new candidate instance.

## Answer

A single deterministic answer uses:

```text
## Answer

VALUE: ANSWER
LABEL: Final answer
UNIT: units
ROUND: 2
TOLERANCE: 0.01
TOLERANCE_TYPE: absolute
EQUIVALENCE: numeric
ACCEPT: alternative answer
```

Supported terms:

```text
VALUE:
LABEL:
TYPE:
UNIT:
ROUND:
TOLERANCE:
TOLERANCE_TYPE:
EQUIVALENCE:
ACCEPT:
```

## Answers

Use `## Answers` for a fixed number of independently graded results:

```text
## Answers

AREA:
LABEL: Area
UNIT: cm²
ROUND: 0

PERIMETER:
LABEL: Perimeter
UNIT: cm
ROUND: 0
```

## Repeated Answers

Use `## Repeated Answers` when the number of answer fields depends on a generated collection.

One answer per matrix row:

```text
## Repeated Answers

ROW_SUMS:
SOURCE: MATRIX
MODE: items
VALUE: sum(VALUE)
LABEL: Sum of row {INDEX}
ROUND: 0
TOLERANCE: 0
EQUIVALENCE: numeric
```

One answer per matrix column:

```text
COLUMN_SUMS:
SOURCE: MATRIX
MODE: columns
VALUE: sum(VALUE)
LABEL: Sum of column {INDEX}
ROUND: 0
```

One answer per record-list item:

```text
JOB_END_TIMES:
SOURCE: JOBS
MODE: items
VALUE: ARRIVAL + DURATION
LABEL: Completion time for job {INDEX}
ROUND: 0
```

Each repeated group supports the normal answer settings:

```text
SOURCE:
MODE:
VALUE:
LABEL:
TYPE:
UNIT:
ROUND:
TOLERANCE:
TOLERANCE_TYPE:
EQUIVALENCE:
ACCEPT:
```

`MODE` accepts `items` or `columns`. Matrix rows use `items`.

A template may combine `## Answer`, `## Answers`, and `## Repeated Answers`. The generated exercise is fully correct only when every concrete answer field is correct.

## Semantic Answer

Semantic templates use an authoritative reference answer:

```text
## Metadata

TYPE: semantic
LANGUAGE: ro

## Semantic Answer

REFERENCE: |
  Răspunsul de referință poate ocupa mai multe linii.
  Toate liniile fac parte din același răspuns.

STRICTNESS: moderate
```

Supported terms:

```text
REFERENCE:
STRICTNESS:
ESSENTIAL_CONCEPTS:
SUPPORTING_CONCEPTS:
ACCEPTED_EXPRESSIONS:
KNOWN_INCORRECT_CLAIMS:
```

`STRICTNESS` accepts `lenient`, `moderate`, `strict`, or `exacting`.

Semantic templates can use collections and dynamic question directives. Their reference answers and feedback can also contain scalar placeholders, loops, conditions, and matrix directives. Gemini is required only when grading a learner answer; without Gemini the attempt is ungradable.

## Choices

The choices section remains reserved for future template-generated multiple-choice options:

```text
## Choices

CORRECT: ANSWER
DISTRACTOR: ANSWER / 10
DISTRACTOR: ANSWER * 10
SHUFFLE: true
```

## Feedback

Supported terms:

```text
HINT:
SOLUTION:
EXPLANATION:
```

Feedback may contain placeholders and dynamic directives. When custom feedback is omitted, Study Forge produces a calculation trace containing generated scalar inputs, required collections, mappings, formulas, constraints, and final answers.

## Complete dynamic example

```text
Consider the following generated matrix:

{{matrix MATRIX}}

Calculate the sum of all elements and the sum of every row.

{{#if SHOW_NOTE == 1}}
Rows are numbered from 1 in the answer labels.
{{/if}}

## Metadata

TITLE: Dynamic matrix sums
TYPE: multiple-answer
SEED: random
LANGUAGE: en

## Definitions

NR_ROWS: number of rows (2..4)
NR_COLUMNS: number of columns (2..5)
SHOW_NOTE: whether to display the row-numbering note (0, 1)

## Collections

MATRIX:
TYPE: matrix
ROWS: NR_ROWS
COLUMNS: NR_COLUMNS
VALUE: 0..9

## Formula

TOTAL_SUM = sum(MATRIX)

## Answer

VALUE: TOTAL_SUM
LABEL: Sum of all elements
ROUND: 0

## Repeated Answers

ROW_SUMS:
SOURCE: MATRIX
MODE: items
VALUE: sum(VALUE)
LABEL: Sum of row {INDEX}
ROUND: 0

## Constraints

TOTAL_SUM > 0

## Feedback

HINT: |
  Add the elements in each generated row.
  The matrix dimensions and values are generated from the stored seed.
```

## Backward compatibility

The original v1.1 sections, scalar placeholders, ranges, mappings, formulas, constraints, single answers, multiple fixed answers, semantic answers, seeds, highlighting, traces, template-driven quizzes, TXT export, and JSON export remain supported.
