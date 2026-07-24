# Changelog

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
- Multi-answer trace and TXT export support.
- Regression tests for template candidate pools, fresh quiz instantiation, semantic templates, and multiple configured answers.

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
