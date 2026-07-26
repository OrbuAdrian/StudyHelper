# Study Forge architecture

## Design goals

The project remains framework-free and client-only while separating deterministic study logic from browser coordination and Gemini-dependent semantic evaluation. Reusable parsing, validation, randomization, language, and quiz-resolution logic lives in small modules that can be tested independently.

## JavaScript modules

### `assets/js/app.js`

The application coordinator. It binds controls, updates views, manages local state, starts quiz and flashcard review sessions, renders feedback, and connects modules to browser persistence and Gemini.

### `assets/js/core/config.js`

Contains application constants, the backward-compatible template example, and `createEmptyState()`. Settings include `uiLanguage` and `contentLanguage`.

### `assets/js/core/i18n.js`

Contains supported language metadata, runtime messages, and the English-to-Romanian interface dictionary. It translates static and dynamically inserted interface text without translating learner-authored or generated content arbitrarily.

### `assets/js/core/utils.js`

Side-effect-free helpers for normalization, escaping, identifiers, formatting, JSON response parsing, and array shuffling. Text normalization uses Unicode decomposition so Romanian diacritics remain compatible with deterministic matching.

### `assets/js/services/gemini-client.js`

Owns Gemini HTTP requests and receives the prompt, key, model, and JSON-mode flag as arguments.

### `assets/js/services/file-reader.js`

Reads TXT files and extracts text from PDFs while exposing progress through a callback.

### `assets/js/services/downloads.js`

Creates browser downloads for TXT and JSON data.

### `assets/js/features/semantic-exercise.js`

Defines the semantic exercise contract and prompt construction. It handles:

- identifying semantic exercises;
- strictness normalization;
- optional concept-guidance normalization;
- concept extraction prompts based on a reference answer;
- semantic evaluation prompts;
- structured Gemini result normalization.

The authoritative reference answer is always retained in `semanticConfig.referenceAnswer`. Semantic multiple-tasks additionally retain one semantic configuration per `answerItems` entry. Grading guidance is never rendered on learner cards. Semantic evaluation has no local fallback.

### `assets/js/features/template-engine.js`

Parses Template Format v2 while remaining compatible with v1.1 and the original compact format. It handles deterministic and semantic templates, scalar values, seeded matrices and lists, repeated and conditional plain-text rendering, multiline values, collection-aware formulas, constraints, single-answer and multiple-tasks configurations, template-generated multiple-choice options, single or multiple semantic reference answers, dependency tracing, highlighted values, and calculation traces.

### `assets/js/features/template-validator.js`

Performs static analysis, deterministic randomized trials, seed reproducibility checks, and generated-structure previews for mathematical templates. It validates dynamic collection instantiation and repeated answer resolution through the same seeded trial path. Semantic templates use structural and instantiation checks without requiring numeric answer validation.

## Dynamic template generation path

Template instantiation proceeds in this order:

1. generate scalar definitions;
2. resolve scalar mappings;
3. generate all seeded collections, including dimensions, rows, cells, list items, and record fields;
4. evaluate early constraints whose inputs now exist;
5. evaluate formula assignments and collection functions;
6. evaluate derived constraints;
7. render conditional blocks, repeated blocks, matrix directives, and placeholders;
8. resolve fixed task-answer configurations and dynamic repeated task groups, or resolve and seed-shuffle a multiple-choice option set;
9. reject duplicate concrete choices when necessary and retry generation;
10. produce the concrete exercise, dependency highlights, and trace.

Templates remain plain text. The renderer understands only the documented structural directives and never evaluates template-provided HTML, CSS, JavaScript, or browser events.

### `assets/js/features/quiz-blueprint.js`

Defines quiz problem slots separately from exercises. Each new slot stores candidate template IDs and snapshots. When a quiz begins, the module selects one template per slot and asks the template engine to instantiate a fresh concrete exercise. Legacy fixed-exercise candidates are retained only for migration compatibility.

### `assets/js/features/answer-validation.js`

Contains deterministic validation: numeric comparison, mathematical-expression equivalence, and optional keyword checks. Semantic validation is intentionally isolated in `semantic-exercise.js` and Gemini.


## Template-based quiz resolution

A saved quiz stores template references rather than generated exercise values:

```json
{
  "id": "problem-slot-id",
  "candidateTemplateIds": ["template-a", "template-b"],
  "templateSnapshots": {}
}
```

At quiz start, each slot is resolved in two stages:

1. select one candidate template;
2. instantiate that template, producing a new seed, values, answer configuration, and concrete question.

The generated exercise records `sourceTemplateId`, `sourceTemplateName`, and `templateSeed` for traceability. The quiz blueprint remains reusable and does not change when an instance is generated.


### `assets/js/features/flashcard-builder.js`

Pure flashcard-domain logic:

- builds the Gemini generation prompt from instantiated semantic template task sources;
- normalizes and validates question and option cards;
- enforces one blank, distinct choices, and one correct option for option cards;
- builds Gemini prompts for short-answer question-card grading;
- normalizes question-card grading responses;
- performs local option-card validation.

## Flashcard generation path

The Flashcard Builder filters the template library to semantic templates only. At generation time, every selected template is instantiated once and converted into one or more semantic source blocks. Gemini receives the resolved questions, task labels, authoritative reference answers, languages, and strictness levels. It chooses whether contextual phrases should be combined or split into multiple atomic cards.

A saved flashcard set stores generated cards, selected template IDs, and compact source snapshots. Question cards are graded through Gemini using a private grading reference. Option cards store their choices and correct answer and are graded locally. Review attempts count correct, graded, and ungradable cards separately.

## Semantic template path

A semantic template is identified by a semantic `TYPE`, `## Semantic Answer`, or `## Semantic Answers`. A single semantic response uses `## Semantic Answer`; semantic multiple-tasks use `TYPE: multiple-tasks` and one task block per response under `## Semantic Answers`. These templates can omit `## Definitions` and `## Formula`. Exercise Lab creates one long-form response control per semantic task and defers each task evaluation to Gemini. This path does not require numeric randomized validation.

## Semantic exercise data model

```json
{
  "id": "exercise-id",
  "type": "semantic",
  "language": "ro",
  "validationKind": "semantic",
  "question": "Explică rolul membranei celulare.",
  "answer": "Răspunsul de referință aprobat de utilizator.",
  "semanticConfig": {
    "strictness": "moderate",
    "referenceAnswer": "Răspunsul de referință aprobat de utilizator.",
    "essentialConcepts": [],
    "supportingConcepts": [],
    "acceptedExpressions": [],
    "knownIncorrectClaims": [],
    "conceptSource": "none"
  }
}
```

Legacy `valid-statement` exercises are migrated to the semantic model when state is loaded or imported.

## Semantic evaluation outcomes

Answer results use three effective states:

```json
{ "gradable": true, "correct": true }
{ "gradable": true, "correct": false }
{ "gradable": false, "correct": null }
```

A missing Gemini key produces the third result. Quiz attempts store:

- `score` — correct gradable answers;
- `graded` — number of answers that could be evaluated;
- `ungradable` — number of semantic answers that could not be evaluated;
- `total` — all quiz problems.

The displayed percentage uses `score / graded`, never `score / total` when ungradable answers exist.

## Language model

The application stores language at two levels:

- `settings.uiLanguage` — interface labels and runtime status text;
- `settings.contentLanguage` — default for new content controls.

Every summary and exercise also stores its own `language`. Quiz blueprints do not impose one language, so a resolved quiz may mix English and Romanian exercises.

## State and persistence

`createEmptyState()` defines summaries, exercises, templates, quizzes, flashcard sets, flashcard attempts, and settings. `loadState()` and workspace import normalize older exercises and quiz blueprints. The Gemini key is persisted only when the remember option is enabled.

## CSS organization

CSS is loaded in dependency order:

1. `tokens.css` — variables and global defaults
2. `layout.css` — application shell
3. `dashboard.css` — overview presentation
4. `components.css` — reusable controls and panels
5. `features.css` — template, semantic exercise, quiz, library, settings, and modal styles
6. `responsive.css` — viewport adaptations

## Adding a feature

1. Add semantic markup to `index.html`.
2. Put reusable deterministic or prompt-building logic under `assets/js/features/`.
3. Put browser or network integration under `assets/js/services/`.
4. Add interface strings to `core/i18n.js` when they need translation.
5. Coordinate the feature from `app.js`.
6. Extend state migration when the stored schema changes.
7. Add a browser-independent test under `tests/`.

## Multiple-choice templates and multiple-tasks naming

Template-generated choice questions use `TYPE: multiple-choice` and `## Choices`. The template engine resolves the correct expression and distractor expressions after definitions, mappings, collections, formulas, and constraints. It rejects duplicate concrete options and shuffles valid options with the same seeded random stream used for the exercise instance.

Exercises with several independently graded fields use the public type name `multiple-tasks`. Fields may be deterministic or semantic; semantic task items carry their own reference answer, strictness, and private guidance. Legacy `multiple-answer` and `multi-answer` values are normalized during parsing and state loading so older browser data remains usable.

## Structured flashcard generation

`features/flashcard-builder.js` defines the flashcard response schema, source normalization, phrase coverage, and card-domain validation. `services/gemini-client.js` passes optional response schemas to Gemini and treats token-limit termination as an incomplete response. `core/utils.js` performs JSON extraction and conservative common-format recovery. `features/template-validator.js` validates every semantic task/reference as a potential flashcard source.

## Flashcard authoring pipeline

`assets/js/features/flashcard-builder.js` now also owns:

- complete recall-unit normalization for acronym/expansion cloze cards;
- local answer-leak detection;
- stable distribution of correct option positions;
- supplemental-card prompt and response contracts;
- full-set wording-review prompt and response contracts.

`assets/js/app.js` coordinates per-template enrichment calls, batched full-set review, set import, current-set editing, and the `savedFlashcards` library collection. Complete sets and individual cards remain separate storage objects.
