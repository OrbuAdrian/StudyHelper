# Notes and memo flashcards

## Note model

A Study Forge note stores free-form text that the learner wants to remember. The title is optional.

```json
{
  "id": "note-id",
  "title": "Optional title",
  "content": "The note text.",
  "language": "en",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

Notes are saved in browser storage, appear in the Notes view and Library, and are included in workspace JSON export/import. Deleting a source note does not delete memo cards that were already generated from it because flashcard sets keep source snapshots and note IDs.

## Memo-card generation

Memo cards are generated only from saved notes. The Flashcard Builder switches to a note pool when `Memo flashcards` is selected.

Gemini is instructed to understand the note before choosing card boundaries:

- a short, focused note normally produces one card;
- a note with several independent facts may produce several cards;
- every card asks one complete question;
- every card contains 3–5 distinct choices;
- exactly one choice is correct;
- distractors must be plausible but not supported as the correct answer by the note;
- no external facts may be silently added.

Long notes are divided into paragraph-aware batches of approximately 4,500 characters. Each batch uses the existing Gemini structured-output compatibility fallbacks and local validation.

## Review behavior

Memo cards are checked locally, like option cards. Their choices are reordered only when review begins. The correct answer advances through the available option positions on successive reviews while the stored card remains unchanged.

Memo cards can be saved individually, imported/exported as part of a flashcard set, reviewed with Gemini for wording similarity, or deleted independently.
