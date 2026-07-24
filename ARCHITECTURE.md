# Study Forge architecture

## Design goals

The project remains framework-free and client-only while separating deterministic study logic from browser coordination and Gemini-dependent semantic evaluation. Reusable parsing, validation, randomization, language, and quiz-resolution logic lives in small modules that can be tested independently.

## JavaScript modules

### `assets/js/app.js`

The application coordinator. It binds controls, updates views, manages local state, starts quiz sessions, renders feedback, and connects modules to browser persistence and Gemini.

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

The authoritative reference answer is always retained in `semanticConfig.referenceAnswer`. Semantic evaluation has no local fallback.

### `assets/js/features/template-engine.js`

Parses Template Format v2 while remaining compatible with v1.1 and the original compact format. It handles deterministic and semantic templates, scalar values, seeded matrices and lists, repeated and conditional plain-text rendering, multiline values, collection-aware formulas, constraints, fixed and repeated answer configurations, semantic reference answers, dependency tracing, highlighted values, and calculation traces.

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
8. resolve fixed answer configurations and dynamic repeated answer groups;
9. produce the concrete exercise, dependency highlights, and trace.

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

## Semantic template path

A semantic template is identified by a semantic `TYPE` or by the presence of `## Semantic Answer`. It can omit `## Definitions` and `## Formula`. Exercise Lab performs a structural instantiation check, creates a normal semantic exercise instance, and defers learner-answer grading to Gemini. This path does not require numeric randomized validation.

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

`createEmptyState()` defines the schema. `loadState()` and workspace import normalize older exercises and quiz blueprints. The Gemini key is persisted only when the remember option is enabled.

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
