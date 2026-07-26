# Changelog

## Flashcard professionalization, enrichment, and set editing

- Distributed correct option positions locally so option-card answers no longer inherit Gemini's first-option ordering.
- Added context-aware cloze normalization for acronym and expansion pairs such as `DRAM (Dynamic Random-Access Memory)`.
- Added local answer-leak validation for option-card statements.
- Added **Generate 1–3 extra cards per template**, using the semantic exercise definition and avoiding facts already explicit in reference answers or existing cards.
- Added **Review wording with Gemini**, which reviews every card and rewrites overly similar cues while preserving answers, choices, grading references, and provenance.
- Added JSON flashcard-set import with validation and migration.
- Added per-card deletion, delete-all-current-cards, and per-card save/update controls.
- Added a `savedFlashcards` library collection and a dedicated **Saved cards** tab.
- Advanced workspace export schema to version 7.
- Added regression coverage for correct-answer placement, acronym/expansion cloze handling, enrichment prompts, wording-review application, and new interface controls.

## Flashcard request compatibility and author diagnostics

- Reduced the Gemini flashcard response schema to the smallest portable subset: `type`, `properties`, `required`, and `items`.
- Added fallback for generic HTTP 400 `INVALID_ARGUMENT` responses even when the API does not explicitly identify `responseSchema` as the rejected field.
- Added a final plain-text JSON-prompt fallback when a selected model rejects both response schemas and JSON MIME mode.
- Preserved per-call diagnostics for schema, JSON MIME, and plain-text fallback attempts without recording the API key.
- Added author-side failure reports showing parsed semantic questions, full reference answers, phrase units, API statuses, raw Gemini responses, and any flashcards parsed before failure.
- Preserved diagnostic data when a batch failure is wrapped by the adaptive queue.
- Added a regression fixture for a Romanian three-task compiler-optimization semantic template.
- Added generic `INVALID_ARGUMENT`, plain-text fallback, and diagnostic-preservation tests.

## Flashcard schema compatibility and batched generation

- Removed unsupported `additionalProperties` and `propertyOrdering` keywords from the Gemini flashcard response schema.
- Added automatic JSON-mode fallback when a selected Gemini model rejects `responseSchema`.
- Changed flashcard generation from one large request to sequential per-source phrase batches.
- Added adaptive batch splitting after repeated malformed, incomplete, truncated, or invalid responses.
- Reduced generated JSON by deriving title, type, language, and private grading references locally.
- Added batch progress reporting, cross-batch deduplication, and final source-coverage validation.
- Added schema-fallback, batching, adaptive-splitting, and source-context regression tests.

## Flashcard structured-output repair and semantic-source validation

- Added Gemini JSON-schema output constraints for question and option flashcard sets.
- Added a conservative malformed-JSON recovery pass for common missing commas and trailing commas.
- Added one automatic regeneration attempt when Gemini returns malformed, incomplete, truncated, or semantically invalid flashcard data.
- Increased the flashcard structured-output budget and report `MAX_TOKENS` truncation explicitly.
- Added semantic flashcard-source validation before any Gemini request.
- Updated the Template Engine validator so semantic templates run randomized structural, reference-answer, phrase-segmentation, placeholder, and seed checks.
- Added separate validation for every task in `## Semantic Answers`.
- Added errors for duplicate semantic fields, unsupported semantic field names, empty references, duplicate source identifiers, and unresolved reference placeholders.
- Added structured-output, JSON-recovery, and multi-reference regression tests.

## Flashcard Builder

- Added a dedicated Flashcard Builder beside Quiz Builder.
- Restricted flashcard source selection to saved semantic templates.
- Instantiated selected semantic templates before generation so placeholders, randomized semantic values, and multiple semantic tasks are resolved.
- Added Gemini-controlled phrase splitting and context-aware phrase combination.
- Added question flashcards with short learner responses and Gemini semantic evaluation.
- Added option flashcards with one blank, 3–5 distinct choices, one stored correct answer, and local validation.
- Kept authoritative grading references hidden during learner review.
- Added author-side previews, saved flashcard sets, TXT/JSON exports, review sessions, and gradable/ungradable scoring.
- Added English and Romanian interface strings for the new workflow.
- Added flashcard-domain regression tests and advanced workspace schema version 6.

## Semantic multiple-tasks and grading privacy

- Added `## Semantic Answers` with separately labeled task blocks, reference answers, strictness settings, and optional guidance.
- Added one long-form learner response field per semantic task.
- Added independent Gemini evaluation for each semantic task and ungradable handling when Gemini is unavailable.
- Removed grading-guidance lists from learner-facing exercise cards; they remain private inputs to semantic evaluation.
- Made the current API-key field available immediately to semantic grading, even before a separate page refresh.
- Hardened multiple-choice validation across static checks, randomized instances, correct-option uniqueness, and seed reproducibility.

## Multiple-choice templates and multiple-tasks terminology

- Added working `TYPE: multiple-choice` template support through `## Choices`.
- Added one `CORRECT:` option, repeated `DISTRACTOR:` options, and seeded `SHUFFLE:` behavior.
- Added validation for missing, duplicate, or invalid choice expressions.
- Added a built-in multiple-choice template example.
- Renamed the learner-facing multi-result model from **multiple-answer** to **multiple-tasks**.
- Added migration for legacy `multiple-answer` and `multi-answer` saved content.
- Preserved separate grading for every task in a multiple-tasks exercise.

## Dynamic Template Format v2

### Added

- Plain-text `## Collections` support for seeded matrices, grids, primitive lists, and record lists.
- Variable collection dimensions and item counts using fixed values, ranges, sets, or scalar expressions.
- `{{matrix NAME}}`, `{{#each NAME}}`, and `{{#if EXPRESSION}}...{{else}}...{{/if}}` learner-facing directives.
- Collection-aware formula functions: `count`, `sum`, `average`, `row`, `column`, `cell`, `contains`, `field`, `sort`, and `unique`.
- `## Repeated Answers` groups that generate one answer field per row, column, or list item.
- Multiline key-value blocks using the `|` marker.
- Generated collection information in calculation traces and validator sample previews.
- A dedicated Template Format v2 regression suite.

### Compatibility

- Existing Template Format v1.1 templates remain valid without modification.
- Template authoring remains plain text; arbitrary HTML, CSS, and JavaScript are not accepted.
- Template-based quizzes instantiate dynamic structures from fresh seeds in the same way they instantiate scalar templates.

## Template-driven quiz and semantic-template release

### Changed

- Quiz problem slots now use saved templates as their candidate pools instead of requiring saved exercise instances.
- Starting or exporting a quiz selects a candidate template for each slot and instantiates it with fresh allowed random values and a fresh seed.
- Saved exercises are no longer part of the normal quiz-building workflow.
- Older exercise-candidate quizzes remain readable through legacy snapshot migration.

### Added

- Semantic/stated-answer templates using `## Semantic Answer`.
- Semantic template instantiation in Exercise Lab, including fixed and randomized semantic questions.
- Structural semantic-template checks that do not require mathematical randomized answer validation.
- Multiple-tasks trace and TXT export support.
- Regression tests for template candidate pools, fresh quiz instantiation, semantic templates, and multiple configured task answers.

### Fixed

- Numeric formula substitutions now wrap negative values, preventing accidental expressions such as `value--5` from being interpreted as a postfix decrement.

## Runtime startup repair

- Restored the known-good application controller after a broad `app.js` rewrite caused the interface to remain visually rendered but inactive.
- Corrected malformed multiline string literals that caused the browser to reject the entire application module before startup.
- Added guarded startup with a visible error panel.
- Added compatibility fallbacks for animation frames, `MutationObserver`, `NodeFilter`, `CSS.escape`, and restricted browser storage.
- Added Windows and Unix local-server launchers.
- Added a startup smoke test that exercises the complete initialization path.

## Bilingual semantic exercise release

### Added

- English and Romanian interface modes.
- Separate default content language and per-item content-language controls.
- Romanian summary and exercise generation prompts with diacritic requirements.
- Semantic exercise types: explanation, definition, comparison, reasoning, phrase completion, and general semantic answer.
- User-authored authoritative reference answers.
- Lenient, moderate, strict, and exacting semantic grading.
- Optional concept guidance: none, manual, or Gemini-generated from the reference answer.
- Structured semantic evaluation results with coverage, missing concepts, incorrect claims, score, and feedback.
- Explicit ungradable answer state when Gemini is unavailable.
- Quiz scoring based only on gradable problems, with ungradable totals stored separately.
- Exercise-level language metadata and mixed-language quizzes.
- `LANGUAGE: en|ro` support in template metadata.
- Romanian-aware deterministic text normalization.

### Compatibility

- Older `valid-statement` exercises are migrated to semantic exercises.
- Existing deterministic exercises, templates, quiz blueprints, and attempts remain supported.
- Existing Template Format v1.1 behavior is unchanged apart from optional language metadata.
