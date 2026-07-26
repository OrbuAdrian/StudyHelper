# Flashcard Builder

## Source eligibility

Only saved semantic templates appear in the Flashcard Builder pool. A template is eligible when it contains `## Semantic Answer`, `## Semantic Answers`, or another semantic template type recognized by the Template Engine.

Before generation, each selected template is instantiated once. This resolves:

- randomized scalar values;
- mappings and formulas used by semantic placeholders;
- dynamic question text;
- every semantic task reference answer;
- the generated seed used for that source snapshot.

For a semantic multiple-tasks template, every task becomes a separate source block with its own label, reference answer, language, and strictness.

## Gemini card-boundary decisions

Study Forge divides each reference answer into traceable phrase units for source coverage, but those units are not fixed card boundaries. Gemini receives the selected source blocks and decides whether to:

- make one card from one phrase;
- make several cards from one information-dense phrase;
- combine adjacent or context-dependent phrases into one card;
- keep unrelated source blocks separate.

The generation prompt requires every card to stay grounded in the user-approved reference answers.


## Failure diagnostics

When a batch cannot be generated, the Flashcard Builder displays an author-side diagnostic report. It includes:

- every parsed semantic task and source key;
- the full parsed reference answer for each task;
- the phrase units created from that reference;
- each Gemini request mode attempted (`json-schema`, `json-mime`, or `plain-text`);
- HTTP and Gemini API statuses and messages;
- the raw response body, when one was returned;
- any flashcard objects parsed before validation failed.

The API key is never included in the diagnostic report. The report is intended for template authors and is not displayed during learner flashcard review.

## Question flashcards

A question flashcard contains:

```json
{
  "type": "question",
  "front": "Which cache misses are reduced by greater associativity?",
  "expectedAnswer": "Conflict misses",
  "gradingReference": "Increasing associativity reduces conflict misses and usually raises the hit rate.",
  "options": [],
  "sourceKeys": ["template-id:TASK_A"]
}
```

The learner types a short answer. Gemini evaluates meaning against `expectedAnswer` and `gradingReference`, accepting supported synonyms, inflections, abbreviations, and equivalent short formulations. The full grading reference is not displayed during review.

When Gemini is unavailable, the response is recorded as ungradable rather than incorrect.

## Option flashcards

An option flashcard contains:

```json
{
  "type": "option",
  "front": "Greater cache associativity primarily reduces ____.",
  "expectedAnswer": "conflict misses",
  "options": ["capacity misses", "conflict misses", "compulsory misses"],
  "sourceKeys": ["template-id:TASK_A"]
}
```

Validation rules:

- the front contains exactly one `____` blank;
- the card contains 3–5 choices;
- choices are distinct using case-insensitive comparison;
- the expected answer occurs exactly once;
- learner validation is local and does not call Gemini.

## Stored set model

```json
{
  "id": "set-id",
  "title": "Cache review",
  "type": "question",
  "templateIds": ["template-id"],
  "sourceSnapshots": [
    {
      "templateId": "template-id",
      "templateName": "Cache associativity",
      "seed": 42,
      "language": "en",
      "sourceKeys": ["template-id:TASK_A"]
    }
  ],
  "flashcards": [],
  "createdAt": "...",
  "updatedAt": "..."
}
```

Saved sets remain usable even if a source template is later edited or removed because the generated cards and their compact source snapshots are stored with the set.

## Review results

Question and option cards share three possible effective outcomes:

```json
{ "gradable": true, "correct": true }
{ "gradable": true, "correct": false }
{ "gradable": false, "correct": null }
```

The final review percentage uses only gradable cards. Question cards without Gemini contribute to the ungradable count; option cards are always gradable.
## Structured-output reliability

Flashcard generation uses a compact Gemini response schema specific to the selected card type. The schema intentionally avoids unsupported full-JSON-Schema keywords such as `additionalProperties` and `propertyOrdering`.

Question-card responses contain only:

- front text;
- expected short answer;
- explanation;
- semantic phrase source keys.

Option-card responses additionally contain 3–5 options.

Study Forge derives the set title, requested card type, card language, and private grading reference locally. The grading reference is reconstructed from the validated semantic phrases identified by each card's source keys.

If a selected Gemini model rejects `responseSchema`, Study Forge automatically retries that request using JSON MIME mode without a schema and remembers that compatibility result for later batches in the current page session. All returned data still passes the same local parser, card validation, and source-coverage checks.

## Batched API calls

Selected semantic material is not sent as one large object. Each semantic task remains a separate source and is divided into batches of at most eight phrase units or approximately 4,500 source characters. Batches are sent sequentially.

For every batch, Study Forge:

1. requests a compact JSON flashcard array;
2. retries once when the output is malformed, incomplete, truncated, or invalid;
3. validates all cards and phrase references;
4. adaptively divides the batch into two smaller adjacent phrase groups when both attempts fail and more than one phrase remains;
5. merges successful batches into one set;
6. combines source keys on duplicate cards;
7. verifies that every original phrase is covered by at least one final card.

A `MAX_TOKENS` response is treated as incomplete and triggers the same split-and-retry path. API-key, quota, network, safety, and unavailable-model errors are reported directly rather than repeatedly splitting the source.

The builder displays batch progress during generation. One selected semantic template may therefore produce one API call or several calls depending on its number of task blocks, reference-answer length, and whether a response needs adaptive splitting.

## Semantic source readiness

Before Gemini is called, every selected semantic template passes the normal Template Engine validator. For flashcard use, Study Forge checks each semantic task separately.

A single semantic template contributes one reference source from `## Semantic Answer`. A semantic multiple-tasks template contributes one source for every block in `## Semantic Answers`. Multiple reference answers are therefore supported and are not merged accidentally.

The validator checks:

- every reference answer is present and non-empty;
- multiline `REFERENCE: |` blocks are parsed completely;
- task identifiers and generated source keys are unique;
- semantic field names are supported and are not duplicated;
- placeholders resolve after template instantiation;
- every reference produces at least one usable phrase unit;
- randomized semantic instances reproduce correctly from the same seed.

Mathematical answer validation is not required for semantic templates. The randomized runs validate structure and generated semantic references, not whether a reference answer is factually correct.

