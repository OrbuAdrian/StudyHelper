# Changelog

## Multi-answer template update

- Added `## Answers` support for template-generated exercises.
- One generated exercise can now require several answer fields.
- Each answer item can define its own label, unit, rounding, tolerance, tolerance type, equivalence mode, and accepted alternatives.
- Template instances retain backward compatibility by keeping the first answer in the legacy `answer` field while storing the complete list in `answerItems`.
- Exercise preview, solution display, calculation traces, TXT quiz export, and quiz player support multi-answer exercises.
- Multi-answer grading reports partial credit, for example `2 of 3 answers correct`.
- Existing single-answer templates and saved exercises continue to work unchanged.
