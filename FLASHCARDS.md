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

The application does not split reference answers itself. Gemini receives the selected source blocks and decides whether to:

- make one card from one phrase;
- make several cards from one information-dense phrase;
- combine adjacent or context-dependent phrases into one card;
- keep unrelated source blocks separate.

The generation prompt requires every card to stay grounded in the user-approved reference answers.

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
