# Changelog

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
