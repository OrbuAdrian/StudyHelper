# Study Forge runtime repair

## Observed symptom

The page layout and styling render, but navigation, buttons, generation controls, and other interactive behavior do not start.

## Confirmed cause

The `assets/js/app.js` file on the repository's `main` branch was broadly rewritten into a compressed form. During that rewrite, at least one HTML fragment assigned to `innerHTML` became a single-quoted string spread across physical lines. JavaScript does not permit an unescaped newline inside a single-quoted string, so the browser rejects the complete ES module before application initialization.

## Repair

This package restores the readable, known-good bilingual and semantic-exercise controller and adds startup hardening:

- guarded application initialization;
- visible startup diagnostics;
- required-element checks;
- compatibility fallbacks for browser APIs;
- safe translation scheduling;
- a full initialization smoke test;
- local HTTP launchers for Windows, macOS, and Linux.

## Files to replace

For the smallest repository correction, replace:

- `assets/js/app.js`
- `assets/js/core/i18n.js`
- `index.html`

Also add:

- `tests/startup-smoke.test.mjs`
- `serve-study-forge.bat`
- `serve-study-forge.sh`

The complete archive already contains all repaired files in their correct paths.

## Running locally

Do not double-click `index.html`, because Study Forge uses native ES modules.

Windows:

```text
serve-study-forge.bat
```

macOS or Linux:

```text
./serve-study-forge.sh
```

Then open:

```text
http://localhost:8080
```

## Validation performed

The following checks pass in this package:

- JavaScript syntax checks for every source module;
- startup initialization smoke test;
- static integration test;
- semantic exercise tests;
- quiz blueprint tests;
- Template Format v1.1 tests;
- template engine and validator tests.
