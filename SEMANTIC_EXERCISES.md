# Semantic exercises

Semantic exercises are open-ended questions whose answers cannot be checked reliably through exact text, numeric tolerance, or symbolic equivalence. They are intended for explanations, definitions, comparisons, reasoning, phrase completion, conceptual programming questions, and other subjects where meaning matters more than wording.

## Authoritative reference answer

Every semantic exercise stores a user-reviewed reference answer. This answer is the grading standard. Gemini is instructed to evaluate the learner against that answer rather than inventing a different standard during each attempt.

A semantic exercise stores:

```json
{
  "type": "semantic",
  "language": "ro",
  "validationKind": "semantic",
  "question": "Explică rolul membranei celulare.",
  "answer": "Membrana delimitează celula și controlează schimburile cu mediul.",
  "semanticConfig": {
    "strictness": "moderate",
    "referenceAnswer": "Membrana delimitează celula și controlează schimburile cu mediul.",
    "essentialConcepts": [],
    "supportingConcepts": [],
    "acceptedExpressions": [],
    "knownIncorrectClaims": [],
    "conceptSource": "none"
  }
}
```

## Optional grading guidance

Concept guidance is optional. The author may:

- leave every list empty;
- enter the lists manually; or
- ask Gemini to derive concise guidance from the reference answer.

The lists are semantic guidance, not mandatory literal keywords:

- `essentialConcepts` — ideas normally needed for a complete answer;
- `supportingConcepts` — details that improve completeness;
- `acceptedExpressions` — known equivalent terminology or phrasing;
- `knownIncorrectClaims` — common misconceptions relevant to the question.

Gemini may still recognize ordinary paraphrases that are not explicitly listed. These guidance lists are author-side data and are not rendered on learner exercise cards.

## Multiple semantic tasks

One exercise may contain several independently graded stated-answer tasks. The learner-facing question contains the task prompts, while each item stores its own label, reference answer, strictness, and optional guidance.

```text
A) Question A?
B) Question B?

## Metadata
TYPE: multiple-tasks
LANGUAGE: en

## Semantic Answers

TASK_A:
LABEL: A) Question A
REFERENCE: |
  Authoritative answer for task A.
STRICTNESS: moderate

TASK_B:
LABEL: B) Question B
REFERENCE: |
  Authoritative answer for task B.
STRICTNESS: strict
```

Study Forge renders one long-form field per task and sends each response to Gemini separately. The exercise is fully correct only when every gradable task is correct. If Gemini is unavailable, the semantic tasks are reported as ungradable rather than incorrect.

## Strictness levels

### Lenient

Accepts the central correct idea. Informal terminology, broad paraphrases, and minor omissions are allowed. Only central misunderstandings or contradictions that overturn the answer cause failure.

### Moderate

Requires the central idea and important supporting ideas. Paraphrasing and small omissions are allowed. Material incompleteness or factual contradictions cause failure.

### Strict

Requires all important ideas, appropriate terminology, and clear reasoning. Any material false statement or contradiction causes failure.

### Exacting

Requires a nearly complete and precise answer relative to the reference answer. Different wording is allowed, but substantive omissions, unsupported claims, or inaccuracies cause failure.

## Gemini availability

Semantic grading deliberately has no local fallback. When Gemini is unavailable or no API key is configured:

- the exercise can still be opened and answered;
- the answer is marked `ungradable` rather than incorrect;
- quiz results exclude it from the graded percentage;
- the attempt records how many answers were ungradable.

## Languages

Semantic exercises can be stored in English or Romanian. The evaluation response is requested in the exercise language. Romanian generation and evaluation prompts explicitly require correct diacritics: `ă`, `â`, `î`, `ș`, and `ț`.

A quiz may mix exercises in both languages because language is stored on each exercise rather than on the quiz blueprint.


## Flashcard eligibility

Every saved semantic template is eligible for the Flashcard Builder. Single-response templates contribute one authoritative source block. Semantic `multiple-tasks` templates contribute one source block per task. The builder instantiates the template first, resolves placeholders and seeded values, segments each reference answer into traceable phrase units, and asks Gemini to combine or split those units into active-recall cards. Private grading guidance is not shown to learners and is not required for flashcard generation.
