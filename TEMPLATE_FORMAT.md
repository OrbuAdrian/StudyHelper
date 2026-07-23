# Study Forge Template Format v1.1

A template starts with the learner-facing exercise text. Generated values are inserted with uppercase placeholders such as `{DATA_AMOUNT}`. The remainder is divided into optional `##` sections.

## Template language metadata

Templates may optionally declare the learner-facing language under `## Metadata`:

```text
LANGUAGE: en
```

or:

```text
LANGUAGE: ro
```

When `LANGUAGE` is omitted, the application uses the current default content language. Section names and parser terms remain in English so templates stay portable, while question text, descriptions, hints, and solutions may be written in English or Romanian.


## Complete example

```text
Calculate the time required in {OUTPUT_UNIT} to transmit {DATA_AMOUNT} KB of data on an asynchronous serial line configured at {BPS} bps, using {DATA_BITS} data bits, {PARITY} parity, and {STOP} stop bit(s).

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
SOLUTION: Calculate FRAME_BITS, then TOTAL_FRAMES, then divide the transmitted frame bits by BPS. Finally convert the result to {OUTPUT_UNIT}.
```

## Section order

The recommended order is:

```text
Exercise text

## Metadata
## Definitions
## Mappings
## Formula
## Constraints
## Answer
## Choices
## Feedback
```

Only the exercise text, `## Definitions`, and `## Formula` are required. Unknown sections are ignored with a validator warning.

## Exercise text and placeholders

The text before the first `##` section is displayed to the learner.

```text
Find the area of a rectangle with length {LENGTH} and width {WIDTH}.
```

Placeholder names must:

- start with an uppercase letter;
- contain only uppercase letters, digits, and underscores;
- have a corresponding definition, mapping output, or formula assignment.

Values that influence the configured final answer are highlighted automatically.

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
MAX_CONSTRAINT_ATTEMPTS:
```

`TYPE` may describe `single-answer`, `multiple-choice`, `valid-statement`, or `phrase`. Template-generated exercises currently use the single-answer workflow unless custom choice behavior is added later.

`SEED` accepts:

```text
SEED: random
SEED: 184205
```

A fixed seed must be an integer from `0` to `4294967295`. The same template and seed reproduce the same generated values, constraint retry sequence, question, and answer. Omitting `SEED` behaves like `SEED: random`.

`MAX_CONSTRAINT_ATTEMPTS` defaults to `1000` and is clamped to a safe implementation limit.

## Definitions

General syntax:

```text
VARIABLE_NAME: description (value rule)
```

### Fixed values

```text
BPS: transmission speed (600)
VOLTAGE: supply voltage (5.0)
PROTOCOL: protocol name ("UART")
```

### Integer ranges

Recommended syntax:

```text
DATA_BITS: data bits per frame (5..8)
```

Legacy syntax remains supported:

```text
DATA_BITS: data bits per frame (5-8)
```

Both endpoints are inclusive.

### Decimal ranges with steps

```text
DATA_AMOUNT: amount in kilobytes (1.0..10.0; step=0.5)
VOLTAGE: voltage level (-5.0..5.0; step=0.25)
```

The step must be positive. When the step does not divide the range evenly, the validator warns that the maximum endpoint cannot be generated.

### Predefined sets

Numeric set:

```text
STOP: stop bits (1, 2)
```

Text set:

```text
PARITY: parity mode (even, odd, none)
```

Mixed numeric and text sets are rejected.

## Mappings

Mappings convert a generated source value into another value used by formulas.

Expanded syntax:

```text
PARITY_BITS: PARITY
none=0
even=1
odd=1
```

This creates `PARITY_BITS` from the selected `PARITY` value.

Legacy compact syntax remains supported in `## Formula`:

```text
PARITY: none=0, even=1, odd=1
```

The legacy form exposes the mapped result as both `PARITY_BITS` and `PARITY_VALUE`.

The validator checks that the source exists, all possible source values are covered, keys are unique, and the mapped result is used.

## Formula

Each line defines a derived numeric variable:

```text
VARIABLE = EXPRESSION
```

The conventional final result is:

```text
ANSWER = EXPRESSION
```

Assignments are evaluated from top to bottom. Referencing a variable before it is defined is an error.

Supported operators:

```text
+  -  *  /  %  ^  ( )
```

Supported constants:

```text
PI
E
```

Supported functions:

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

Text variables cannot be used directly in numeric formulas. Convert them with a mapping first.

## Constraints

Each line is a Boolean expression that must be true for an instance to be accepted.

```text
DATA_AMOUNT > 0
A != B
LENGTH > WIDTH
NOT (DATA_BITS == 5 AND STOP == 2)
VOLTAGE >= 1.5 AND VOLTAGE <= 12
```

Supported comparison operators:

```text
==  !=  <  <=  >  >=
```

Supported logical operators:

```text
AND  OR  NOT
```

Arithmetic and formula functions may be used inside constraints.

Constraints that reference only definitions and mapping outputs are evaluated before formulas. This makes safety constraints such as `DENOMINATOR != 0` effective before division. Constraints that reference derived formula variables are evaluated after formulas.

When any constraint is false, the seeded generator advances and tries another value combination. Generation fails with a clear error after the maximum number of attempts.

## Answer

Supported terms:

```text
VALUE:
UNIT:
ROUND:
TOLERANCE:
TOLERANCE_TYPE:
EQUIVALENCE:
ACCEPT:
```

Example:

```text
VALUE: ANSWER
UNIT: OUTPUT_UNIT
ROUND: 2
TOLERANCE: 0.01
TOLERANCE_TYPE: absolute
EQUIVALENCE: numeric
ACCEPT: alternative answer, another accepted phrase
```

`VALUE` names the calculated variable used as the expected answer. Without an `## Answer` section, `ANSWER` is used when present; otherwise the final formula assignment is used.

`UNIT` can be fixed text or the name of a generated variable.

`ROUND` accepts an integer from `0` to `15`.

`TOLERANCE_TYPE` accepts:

```text
absolute
percentage
```

`EQUIVALENCE` accepts:

```text
exact
numeric
symbolic
semantic
combined
```

The current local template exercise workflow applies exact, numeric, and symbolic checks where supported. Semantic checks require Gemini.

## Choices

The section and these terms are reserved for future multiple-choice template generation:

```text
## Choices

CORRECT: ANSWER
DISTRACTOR: ANSWER / 10
DISTRACTOR: ANSWER * 10
SHUFFLE: true
```

The parser preserves these values, but the current template generator does not yet construct multiple-choice options from them.

## Feedback

Supported terms:

```text
HINT:
SOLUTION:
EXPLANATION:
```

Generated and calculated values can be inserted:

```text
SOLUTION: Each frame contains {FRAME_BITS} bits, so the final result is {ANSWER}.
```

When no custom solution or explanation is supplied, Study Forge generates a calculation trace from the relevant dependency chain.

## Backward compatibility

The original minimal format remains valid:

```text
Question containing {VALUES}.

## Definitions

VALUE: description (1-10)
MODE: description (even, odd, none)

## Formula

MODE: even=1, odd=1, none=0
ANSWER = VALUE + MODE_BITS
```
