# Study Forge

Study Forge is a client-only study workspace built with HTML, CSS, and JavaScript. It creates Gemini-assisted summaries and exercises, generates deterministic exercises from local templates, builds randomized multi-problem quizzes, validates answers, and stores work in the browser.

## Run locally

Use a local web server because the application loads JavaScript modules and PDF support:

```bash
cd study-forge-bilingual-semantic
python3 -m http.server 8080
```

Open `http://localhost:8080` in a modern browser.

## Main capabilities

- English and Romanian interface modes.
- Independent content-language selection for summaries and exercises.
- Topic, pasted-text, TXT, and PDF study sources.
- Gemini-generated summaries in English or Romanian.
- Deterministic multiple-choice and single-answer exercises.
- Semantic explanation, definition, comparison, reasoning, and phrase-completion exercises.
- User-approved reference answers for semantic grading.
- Lenient, moderate, strict, and exacting semantic validation.
- Optional concept guidance entered manually or derived by Gemini from the reference answer.
- Semantic questions become ungradable—not incorrect—when Gemini is unavailable.
- Template Format v1.1 with seeds, constraints, stepped decimal ranges, mappings, answer settings, highlighting, validation, and calculation traces.
- Quiz blueprints with unlimited problem slots and independent random candidate pools.
- Mixed-language quizzes.
- Local browser persistence and TXT/JSON export.

## Language model

Two language settings are available:

- **Interface language** controls application labels and navigation.
- **Default content language** initializes new summary and exercise controls.

Each saved summary and exercise retains its own language. A quiz can therefore contain English and Romanian problems at the same time.

Romanian prompts require correct Romanian diacritics. Romanian text normalization also removes diacritic differences for deterministic comparisons, so text such as `membrană` and `membrana` can be normalized consistently where local matching is used.

## Semantic exercises

Semantic exercises use a reference answer as the authoritative grading standard. They support:

- explanations;
- definitions;
- comparisons;
- reasoning and justification;
- phrase completion;
- conceptual science and programming questions;
- other non-formula subjects.

Optional grading guidance includes essential concepts, supporting concepts, accepted expressions, and known incorrect claims. These lists may be omitted, supplied manually, or generated from the reference answer.

Strictness controls how Gemini treats paraphrases, omissions, terminology, and incorrect factual claims. See [`SEMANTIC_EXERCISES.md`](SEMANTIC_EXERCISES.md) for the complete behavior.

Semantic exercises have no keyword-only fallback. Without Gemini they are recorded as ungradable, and quiz percentages use only gradable problems.

## Gemini setup

Open **Settings**, paste a Gemini API key, select a model, and test the connection. Gemini is used only for:

- AI summary generation;
- AI exercise generation;
- automatic semantic concept guidance;
- semantic answer evaluation.

The optional **Remember API key** setting stores the key in `localStorage`. Without it, the key remains in `sessionStorage` for the current browser session. A client-only application cannot fully protect a browser-visible key, so use a restricted key and avoid remembering it on shared devices.

## Template Format v1.1

The complete example is loaded automatically in the Template Engine. A detailed reference is available in [`TEMPLATE_FORMAT.md`](TEMPLATE_FORMAT.md).

Supported sections:

```text
Question text with {PLACEHOLDERS}

## Metadata
## Definitions
## Mappings
## Formula
## Constraints
## Answer
## Choices
## Feedback
```

Important features include:

- inclusive integer ranges: `(5..8)`;
- stepped decimal ranges: `(1.0..10.0; step=0.5)`;
- fixed or random seeds;
- expanded mappings;
- Boolean constraints;
- constraint-aware generation retries;
- answer rounding, tolerance, equivalence, alternatives, and units;
- dependency-based value highlighting;
- template validation and calculation traces.

Templates may include `LANGUAGE: en` or `LANGUAGE: ro` under `## Metadata`. When omitted, the current default content language is used.

## Quiz blueprints

Exercises and quizzes are distinct objects:

- An **exercise** is one concrete question with its answer and validation rules.
- A **quiz** is a reusable blueprint containing any number of problem slots.
- Every problem slot contains one or more candidate exercises.
- Starting a quiz selects one candidate independently for each problem.
- Optional shuffling changes the order of the resolved problems.
- JSON exports preserve the reusable blueprint; TXT exports create one concrete randomized instance.

Quiz results track `score`, `graded`, and `ungradable`. Semantic questions without Gemini are excluded from the graded percentage.

## Tests

Run all browser-independent tests with:

```bash
node tests/template-validator.test.mjs
node tests/template-format-v11.test.mjs
node tests/quiz-blueprint.test.mjs
node tests/semantic-exercise.test.mjs
node tests/static-integration.test.mjs
```

## Project structure

```text
study-forge-bilingual-semantic/
├── index.html
├── README.md
├── ARCHITECTURE.md
├── TEMPLATE_FORMAT.md
├── SEMANTIC_EXERCISES.md
├── tests/
│   ├── template-validator.test.mjs
│   ├── template-format-v11.test.mjs
│   ├── quiz-blueprint.test.mjs
│   ├── semantic-exercise.test.mjs
│   └── static-integration.test.mjs
└── assets/
    ├── css/
    │   ├── tokens.css
    │   ├── layout.css
    │   ├── dashboard.css
    │   ├── components.css
    │   ├── features.css
    │   └── responsive.css
    └── js/
        ├── app.js
        ├── core/
        │   ├── config.js
        │   ├── i18n.js
        │   └── utils.js
        ├── services/
        │   ├── downloads.js
        │   ├── file-reader.js
        │   └── gemini-client.js
        └── features/
            ├── answer-validation.js
            ├── quiz-blueprint.js
            ├── semantic-exercise.js
            ├── template-engine.js
            └── template-validator.js
```

## External browser dependencies

- Gemini API for AI generation and semantic validation
- PDF.js for PDF text extraction
- math.js for expression equivalence
- Google Fonts for typography

The template engine, quiz blueprint resolution, local storage, TXT handling, direct deterministic exercises, numeric checks, and symbolic checks do not require Gemini.
