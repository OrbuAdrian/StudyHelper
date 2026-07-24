import {
  DEFAULT_TEMPLATE,
  SESSION_KEY,
  SOURCE_LIMIT,
  STORAGE_KEY,
  createEmptyState
} from './core/config.js';
import {
  cleanModelText,
  clone,
  escapeAttr,
  escapeHtml,
  formatAnswer,
  formatBytes,
  formatDate,
  friendlyApiError,
  humanizeType,
  inferTitle,
  normalizeText,
  parseJsonResponse,
  shuffleArray,
  slugify,
  stripMarkdown,
  truncate,
  uid
} from './core/utils.js';
import { downloadJson, downloadText } from './services/downloads.js';
import { readStudyFile } from './services/file-reader.js';
import { callGemini as requestGemini } from './services/gemini-client.js';
import { instantiateTemplate, isSemanticTemplate, parseTemplate } from './features/template-engine.js';
import { validateTemplate } from './features/template-validator.js';
import {
  createQuizProblem,
  getProblemCandidates,
  normalizeQuizProblems,
  resolveQuizProblems,
  setProblemCandidates,
  validateQuizProblems
} from './features/quiz-blueprint.js';
import {
  areExpressionsEquivalent,
  checkKeywords,
  compareNumericAnswers,
  looksLikeExpression
} from './features/answer-validation.js';
import {
  buildConceptExtractionPrompt,
  buildSemanticEvaluationPrompt,
  isSemanticExercise,
  normalizeSemanticConfig,
  normalizeSemanticEvaluation,
  normalizeStrictness
} from './features/semantic-exercise.js';
import {
  getLanguageName,
  t,
  translateInterface
} from './core/i18n.js';

'use strict';

let state = loadState();
let activeLibraryTab = 'summaries';
let pendingConfirmAction = null;
let quizSession = null;
let lastTemplateValidation = null;
let translationFrame = null;
const els = {};

function startApplication() {
  try {
    init();
    document.documentElement.dataset.studyForgeReady = 'true';
  } catch (error) {
    console.error('Study Forge could not start:', error);
    showStartupFailure(error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApplication, { once: true });
} else {
  queueMicrotask(startApplication);
}

function init() {
  document.querySelectorAll('[id]').forEach(el => { els[el.id] = el; });
  assertRequiredElements();
  bindNavigation(); bindGeneralControls(); bindSourceControls(); bindSummaryControls();
  bindExerciseControls(); bindQuizControls(); bindLibraryControls(); bindSettingsControls(); bindModalControls();
  applyStoredStateToUI(); renderAll();

  if (typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => scheduleInterfaceTranslation());
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

function assertRequiredElements() {
  const required = [
    'mobileMenuButton', 'sidebar', 'mobileScrim', 'themeToggle',
    'sourceText', 'sourceTitle', 'useSourceButton', 'generateSummaryButton',
    'generateAiExerciseButton', 'createDirectExerciseButton', 'addQuizProblemButton',
    'interfaceLanguage', 'interfaceLanguageQuick', 'defaultContentLanguage'
  ];
  const missing = required.filter(id => !els[id]);
  if (missing.length) throw new Error(`Missing required interface elements: ${missing.join(', ')}`);
}

function showStartupFailure(error) {
  const existing = document.getElementById('startupFailure');
  if (existing) return;
  const panel = document.createElement('div');
  panel.id = 'startupFailure';
  panel.setAttribute('role', 'alert');
  panel.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;z-index:99999;padding:14px 16px;border-radius:12px;background:#7f1d1d;color:#fff;font:14px/1.45 system-ui,sans-serif;box-shadow:0 12px 36px rgba(0,0,0,.28)';
  const message = error instanceof Error ? error.message : String(error || 'Unknown startup error');
  panel.textContent = `Study Forge could not start. Open the browser console for details. ${message}`;
  document.body.appendChild(panel);
}

function scheduleInterfaceTranslation() {
  const cancelFrame = globalThis.cancelAnimationFrame || clearTimeout;
  const requestFrame = globalThis.requestAnimationFrame || (callback => setTimeout(callback, 0));
  if (translationFrame) cancelFrame(translationFrame);
  translationFrame = requestFrame(() => {
    try {
      translateInterface(document.body, state.settings.uiLanguage || 'en');
    } catch (error) {
      console.warn('Interface translation was skipped:', error);
    } finally {
      translationFrame = null;
    }
  });
}

function loadState() {
    const base = createEmptyState();
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!stored || typeof stored !== 'object') return base;
      const merged = {
        ...base, ...stored,
        source: { ...base.source, ...(stored.source || {}) },
        settings: { ...base.settings, ...(stored.settings || {}) },
        summaries: Array.isArray(stored.summaries) ? stored.summaries : [],
        exercises: Array.isArray(stored.exercises) ? stored.exercises.map(normalizeStoredExercise) : [],
        templates: Array.isArray(stored.templates) ? stored.templates : [],
        quizzes: Array.isArray(stored.quizzes) ? stored.quizzes : [],
        attempts: Array.isArray(stored.attempts) ? stored.attempts : [],
        quizDraft: []
      };
      merged.quizDraft = normalizeQuizProblems(stored.quizDraft || [], merged.templates, merged.exercises);
      merged.quizzes = merged.quizzes.map(quiz => ({
        ...quiz,
        problems: normalizeQuizProblems(quiz.problems || quiz.exercises || [], merged.templates, merged.exercises)
      }));
      if (merged.currentExercise) merged.currentExercise = normalizeStoredExercise(merged.currentExercise);
      if (!merged.settings.rememberApiKey) merged.settings.apiKey = '';
      return merged;
    } catch (error) {
      console.warn('Unable to load saved state:', error);
      return base;
    }
  }

function normalizeStoredExercise(exercise) {
  if (!exercise || typeof exercise !== 'object') return exercise;
  const semantic = isSemanticExercise(exercise);
  const type = exercise.type === 'valid-statement' ? 'semantic' : exercise.type;
  return {
    ...exercise,
    type,
    language: ['en', 'ro'].includes(exercise.language) ? exercise.language : 'en',
    validationKind: semantic ? 'semantic' : (exercise.validationKind || 'deterministic'),
    semanticConfig: semantic
      ? normalizeSemanticConfig(exercise.semanticConfig || {
          strictness: 'moderate',
          referenceAnswer: exercise.answer,
          essentialConcepts: exercise.requiredKeywords || [],
          conceptSource: exercise.requiredKeywords?.length ? 'manual' : 'none'
        }, exercise.answer)
      : exercise.semanticConfig
  };
}

function saveState() {
    try {
      const toStore = clone(state);
      if (!toStore.settings.rememberApiKey) toStore.settings.apiKey = '';
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
      if (!state.settings.rememberApiKey && state.settings.apiKey) sessionStorage.setItem(SESSION_KEY, state.settings.apiKey);
      else sessionStorage.removeItem(SESSION_KEY);
      updateStorageIndicators(); renderStats();
    } catch (error) {
      toast('Storage error', 'The browser could not save this change.', 'error');
      console.error(error);
    }
  }

function bindNavigation() {
    document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => navigateTo(button.dataset.view)));
    document.querySelectorAll('[data-view-jump]').forEach(button => button.addEventListener('click', () => navigateTo(button.dataset.viewJump)));
    window.addEventListener('hashchange', () => {
      const view = location.hash.replace('#', '');
      if (view && document.getElementById(`view-${view}`)) navigateTo(view, false);
    });
  }

function navigateTo(viewName, updateHash = true) {
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === `view-${viewName}`));
    document.querySelectorAll('.nav-item[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === viewName));
    const view = document.getElementById(`view-${viewName}`);
    if (view) {
      els.viewTitle.textContent = view.dataset.title || viewName;
      els.viewEyebrow.textContent = view.dataset.eyebrow || 'Workspace';
      if (updateHash) history.replaceState(null, '', `#${viewName}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    closeMobileMenu();
    if (viewName === 'library') renderLibrary();
    if (viewName === 'quiz') renderQuizBuilder();
  }

function bindGeneralControls() {
    els.mobileMenuButton.addEventListener('click', () => { els.sidebar.classList.add('open'); els.mobileScrim.classList.add('open'); });
    els.mobileScrim.addEventListener('click', closeMobileMenu);
    els.themeToggle.addEventListener('click', () => {
      state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
      document.body.dataset.theme = state.settings.theme; saveState();
    });
  }
function closeMobileMenu() { els.sidebar.classList.remove('open'); els.mobileScrim.classList.remove('open'); }

function bindSourceControls() {
    els.sourceText.addEventListener('input', updateSourceCharCount);
    els.useSourceButton.addEventListener('click', saveActiveSourceFromInputs);
    els.clearSourceButton.addEventListener('click', () => { els.sourceTitle.value = ''; els.sourceText.value = ''; updateSourceCharCount(); });
    els.sourceFile.addEventListener('change', event => { const file = event.target.files?.[0]; if (file) processSourceFile(file); event.target.value = ''; });
    ['dragenter', 'dragover'].forEach(type => els.dropZone.addEventListener(type, event => { event.preventDefault(); els.dropZone.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(type => els.dropZone.addEventListener(type, event => { event.preventDefault(); els.dropZone.classList.remove('drag-over'); }));
    els.dropZone.addEventListener('drop', event => { const file = event.dataTransfer.files?.[0]; if (file) processSourceFile(file); });
  }

function updateSourceCharCount() {
    const count = els.sourceText.value.length;
    els.sourceCharCount.textContent = `${count.toLocaleString()} characters${count > SOURCE_LIMIT ? ` — first ${SOURCE_LIMIT.toLocaleString()} will be used` : ''}`;
  }

function saveActiveSourceFromInputs() {
    const text = els.sourceText.value.trim();
    const title = els.sourceTitle.value.trim() || inferTitle(text);
    if (!text) return toast('Add study material', 'Enter a topic, paste text, or load a file first.', 'error');
    state.source = { ...state.source, title, text: text.slice(0, SOURCE_LIMIT), type: state.source.fileName ? state.source.type : 'text', updatedAt: new Date().toISOString() };
    saveState(); renderSourceStatus(); toast('Source ready', `“${title}” is now the active study source.`, 'success');
  }

async function processSourceFile(file) {
    setFileProgress(true, file.name, 5);

    try {
      const { extension, text } = await readStudyFile(
        file,
        percent => setFileProgress(true, file.name, percent)
      );

      if (!text) throw new Error('No readable text was found in the file.');

      els.sourceTitle.value = file.name.replace(/\.[^.]+$/, '');
      els.sourceText.value = text;
      state.source = {
        title: els.sourceTitle.value,
        text,
        type: extension,
        fileName: file.name,
        updatedAt: new Date().toISOString()
      };

      updateSourceCharCount();
      saveState();
      renderSourceStatus();
      setFileProgress(true, file.name, 100);
      toast(
        'File loaded',
        `${file.name} was extracted locally and set as the active source.`,
        'success'
      );
    } catch (error) {
      console.error(error);
      toast(
        error.message === 'Choose a TXT or PDF file.'
          ? 'Unsupported file'
          : 'Could not read file',
        error.message || 'The file could not be processed.',
        'error'
      );
    } finally {
      setTimeout(() => setFileProgress(false), 700);
    }
  }

function setFileProgress(show, name = '', percent = 0) {
    els.fileProgress.classList.toggle('hidden', !show);
    if (show) { els.fileProgressName.textContent = name; els.fileProgressPercent.textContent = `${percent}%`; els.fileProgressBar.style.width = `${percent}%`; }
  }

function bindSummaryControls() {
    els.generateSummaryButton.addEventListener('click', generateSummary);
    els.copySummaryButton.addEventListener('click', () => copyText(state.currentSummary?.content || ''));
    els.saveSummaryButton.addEventListener('click', saveCurrentSummary);
    els.exportSummaryTxtButton.addEventListener('click', () => state.currentSummary && downloadText(`${slugify(state.currentSummary.title)}-summary.txt`, state.currentSummary.content));
    els.exportSummaryJsonButton.addEventListener('click', () => state.currentSummary && downloadJson(`${slugify(state.currentSummary.title)}-summary.json`, state.currentSummary));
  }

async function generateSummary() {
    if (!ensureSource() || !ensureApiKey()) return;
    const controls = { language: els.summaryLanguage.value, difficulty: els.summaryDifficulty.value, style: els.summaryStyle.value, length: els.summaryLength.value, examples: els.summaryExamples.checked, terms: els.summaryTerms.checked };
    setButtonLoading(els.generateSummaryButton, true, 'Generating…');
    els.summaryOutput.className = 'output-content loading-state';
    els.summaryOutput.innerHTML = '<div><div class="loading-spinner"></div><strong>Building your summary</strong><p>Gemini is organizing the source into focused study notes.</p></div>';
    try {
      const content = await callGemini(buildSummaryPrompt(state.source, controls));
      state.currentSummary = { id: uid(), title: state.source.title, content: cleanModelText(content), language: controls.language, controls, sourceTitle: state.source.title, createdAt: new Date().toISOString() };
      renderSummaryOutput();
    } catch (error) { renderSummaryError(error); }
    finally { setButtonLoading(els.generateSummaryButton, false); }
  }

function buildSummaryPrompt(source, controls) {
    const outputLanguage = getLanguageName(controls.language, 'en');
    return `You are an expert tutor for mathematics, science, programming, and other academic subjects. Create exactly one ${outputLanguage}-language ${controls.length} ${controls.style.replace('-', ' ')} summary for a ${controls.difficulty.toLowerCase()} learner.

Requirements:
- Write the entire learner-facing output in ${outputLanguage}.
- When writing Romanian, use correct Romanian diacritics (ă, â, î, ș, ț).
- Be accurate, structured, and self-contained.
- Use descriptive headings and concise bullet points.
- Explain relationships and reasoning, not only facts.
- ${controls.examples ? 'Include short examples where useful.' : 'Do not add examples unless essential.'}
- ${controls.terms ? 'Include a Key Terms section with brief definitions.' : 'Do not create a separate key-terms section.'}
- End with 3-5 high-value recall prompts, not answers.
- Do not mention these instructions or Gemini.

Source title: ${source.title}
Source material:
${source.text}`;
  }

function renderSummaryOutput() {
    const item = state.currentSummary; if (!item) return;
    els.summaryOutputTitle.textContent = item.title; els.summaryOutput.className = 'output-content generated-content';
    els.summaryOutput.innerHTML = renderSimpleMarkdown(item.content); els.summaryActions.classList.remove('hidden');
  }
function renderSummaryError(error) {
    els.summaryOutput.className = 'output-content empty-state';
    els.summaryOutput.innerHTML = `<span>!</span><strong>Summary generation failed</strong><p>${escapeHtml(friendlyApiError(error))}</p>`;
    els.summaryActions.classList.add('hidden'); toast('Gemini request failed', friendlyApiError(error), 'error');
  }
function saveCurrentSummary() {
    if (!state.currentSummary) return;
    if (state.summaries.some(item => item.id === state.currentSummary.id)) return toast('Already saved', 'This summary is already in your library.', 'info');
    state.summaries.unshift(clone(state.currentSummary)); saveState(); renderRecentWork(); toast('Summary saved', 'The summary was added to your local library.', 'success');
  }

function bindExerciseControls() {
    document.querySelectorAll('[data-exercise-tab]').forEach(button => button.addEventListener('click', () => switchExerciseTab(button.dataset.exerciseTab)));
    els.generateAiExerciseButton.addEventListener('click', generateAiExercise);
    els.aiExerciseType.addEventListener('change', updateAiExerciseControls);
    els.loadExampleTemplateButton.addEventListener('click', () => {
      els.templateName.value = 'Asynchronous serial transmission';
      els.templateText.value = DEFAULT_TEMPLATE;
      clearTemplateValidation();
      toast('Example loaded', 'The example demonstrates all current sections, stepped ranges, mappings, constraints, answer rules, feedback, and seeds.', 'info');
    });
    els.templateText.addEventListener('input', markTemplateValidationStale);
    els.validateTemplateButton.addEventListener('click', () => validateCurrentTemplate());
    els.generateTemplateExerciseButton.addEventListener('click', generateTemplateExercise);
    els.saveTemplateButton.addEventListener('click', saveCurrentTemplate);
    els.importTemplateButton.addEventListener('click', () => els.templateImportFile.click());
    els.templateImportFile.addEventListener('change', event => importTemplateFile(event.target.files?.[0]));
    els.directType.addEventListener('change', updateDirectExerciseControls);
    els.directConceptMode.addEventListener('change', updateDirectExerciseControls);
    els.createDirectExerciseButton.addEventListener('click', createDirectExercise);
    updateAiExerciseControls();
    updateDirectExerciseControls();
  }

function isSemanticType(type) {
  return ['semantic', 'semantic-explanation', 'definition', 'comparison', 'reasoning', 'phrase-completion', 'valid-statement', 'stated-answer'].includes(type);
}

function updateAiExerciseControls() {
  const semantic = isSemanticType(els.aiExerciseType.value);
  els.aiSemanticSettings.classList.toggle('hidden', !semantic);
  els.aiCalculationPreference.classList.toggle('hidden', semantic);
}

function updateDirectExerciseControls() {
  const type = els.directType.value;
  const semantic = isSemanticType(type);
  els.directOptionsWrap.classList.toggle('hidden', type !== 'multiple-choice');
  els.directSemanticWrap.classList.toggle('hidden', !semantic);
  els.directKeywordsWrap.classList.toggle('hidden', semantic);
  els.directManualConcepts.classList.toggle('hidden', !semantic || els.directConceptMode.value !== 'manual');
  els.directAnswerLabel.textContent = semantic ? 'Reference answer' : 'Correct answer';
  els.directAnswer.placeholder = semantic
    ? 'Write the most valid and complete answer expected from the learner…'
    : 'Expected answer or correct option';
  scheduleInterfaceTranslation();
}

function switchExerciseTab(tab) {
    document.querySelectorAll('[data-exercise-tab]').forEach(button => button.classList.toggle('active', button.dataset.exerciseTab === tab));
    document.querySelectorAll('.exercise-tab').forEach(panel => panel.classList.toggle('active', panel.id === `exercise-tab-${tab}`));
  }

async function generateAiExercise() {
    if (!ensureSource() || !ensureApiKey()) return;
    const type = els.aiExerciseType.value;
    const difficulty = els.aiExerciseDifficulty.value;
    const language = els.aiExerciseLanguage.value;
    const strictness = normalizeStrictness(els.aiSemanticStrictness.value);
    const conceptMode = els.aiConceptMode.value;
    setButtonLoading(els.generateAiExerciseButton, true, 'Generating…');
    setExerciseHostLoading(els.aiExerciseHost);
    try {
      const raw = await callGemini(
        buildExercisePrompt(type, difficulty, language, els.aiExerciseFocus.value.trim(), els.aiRequireCalculation.checked, strictness, conceptMode),
        true
      );
      const exercise = normalizeGeneratedExercise(parseJsonResponse(raw), {
        type,
        difficulty,
        language,
        source: 'gemini',
        strictness,
        conceptMode
      });
      state.currentExercise = exercise;
      renderExerciseCard(exercise, els.aiExerciseHost);
    } catch (error) {
      renderExerciseHostError(els.aiExerciseHost, error);
    } finally {
      setButtonLoading(els.generateAiExerciseButton, false);
    }
  }

function buildExercisePrompt(type, difficulty, language, focus, preferCalculation, strictness, conceptMode) {
    const outputLanguage = getLanguageName(language, 'en');
    const semantic = isSemanticType(type);
    const typeRules = {
      'multiple-choice': 'Create one multiple-choice question with exactly four distinct options and exactly one correct option.',
      'single-answer': 'Create one question with a concise numerical, symbolic, code-output, or short factual answer.',
      'semantic-explanation': 'Create one open-ended explanation question whose answer is judged by meaning and factual validity.',
      definition: 'Create one open-ended definition question that asks the learner to define a concept accurately.',
      comparison: 'Create one open-ended comparison question that requires meaningful similarities, differences, or both.',
      reasoning: 'Create one open-ended reasoning question that requires a justified explanation, not a one-word response.',
      'phrase-completion': 'Create one phrase-completion question. The learner may use semantically equivalent wording when appropriate.'
    };
    const semanticSchema = semantic
      ? `
Because this is a semantic exercise:
- answer must be the most valid, complete, learner-facing reference answer and will become authoritative after user review.
- strictness is ${strictness}.
- ${conceptMode === 'automatic' ? 'Derive concise optional grading guidance from the reference answer.' : 'Return empty arrays for all grading guidance lists.'}
- requiredKeywords is deprecated for semantic exercises and must be an empty array.
- semanticConfig must use this shape:
  {
    "strictness": "${strictness}",
    "essentialConcepts": ["..."],
    "supportingConcepts": ["..."],
    "acceptedExpressions": ["..."],
    "knownIncorrectClaims": ["..."],
    "conceptSource": "${conceptMode === 'automatic' ? 'automatic' : 'none'}"
  }`
      : '- semanticConfig must be null.';

    return `You are an expert tutor for mathematics, science, programming, and other academic subjects. ${typeRules[type] || typeRules['single-answer']}

Difficulty: ${difficulty}
Output language: ${outputLanguage}
${focus ? `Focus: ${focus}` : ''}
${preferCalculation && !semantic ? 'Prefer a calculation or symbolic reasoning task when appropriate.' : ''}
Use only information supported by the source or standard foundational knowledge required to understand it.
Write every learner-facing field in ${outputLanguage}. When writing Romanian, use correct diacritics (ă, â, î, ș, ț).
${semanticSchema}

Return valid JSON only, without markdown fences, using this shape:
{
  "question": "...",
  "options": ["..."],
  "answer": "...",
  "requiredKeywords": ["..."],
  "semanticConfig": null,
  "hint": "...",
  "explanation": "..."
}
For non-multiple-choice questions, options must be an empty array. Keep the explanation concise but complete. Do not reveal the answer inside the question.

Source title: ${state.source.title}
Source material:
${state.source.text}`;
  }

function normalizeGeneratedExercise(raw, defaults = {}) {
    if (!raw || typeof raw !== 'object') throw new Error('Gemini returned an invalid exercise format.');
    const question = String(raw.question || '').trim();
    const answer = String(raw.answer ?? '').trim();
    if (!question || !answer) throw new Error('The generated exercise is missing a question or answer.');
    const options = Array.isArray(raw.options) ? raw.options.map(String).filter(Boolean) : [];
    if (defaults.type === 'multiple-choice' && options.length < 2) {
      throw new Error('The generated multiple-choice exercise did not contain enough options.');
    }

    const semantic = isSemanticType(defaults.type || raw.type)
      || Boolean(raw.semanticConfig)
      || raw.validationKind === 'semantic';
    const semanticConfig = semantic
      ? normalizeSemanticConfig({
          ...(raw.semanticConfig || {}),
          strictness: defaults.strictness || raw.semanticConfig?.strictness,
          referenceAnswer: answer,
          conceptSource: defaults.conceptMode || raw.semanticConfig?.conceptSource
        }, answer)
      : null;

    return {
      id: uid(),
      type: defaults.type || raw.type || 'single-answer',
      difficulty: defaults.difficulty || raw.difficulty || 'Intermediate',
      language: ['en', 'ro'].includes(defaults.language || raw.language)
        ? (defaults.language || raw.language)
        : (state.settings.contentLanguage || 'en'),
      validationKind: semantic ? 'semantic' : 'deterministic',
      question,
      options,
      answer,
      requiredKeywords: semantic
        ? []
        : (Array.isArray(raw.requiredKeywords) ? raw.requiredKeywords.map(String).filter(Boolean) : []),
      semanticConfig,
      hint: String(raw.hint || '').trim(),
      explanation: String(raw.explanation || '').trim(),
      variables: raw.variables && typeof raw.variables === 'object' ? raw.variables : null,
      source: defaults.source || raw.source || 'direct',
      sourceTitle: state.source.title || '',
      createdAt: new Date().toISOString()
    };
  }

function buildExerciseFromTemplateResult(result, template = {}) {
    const semantic = result.kind === 'semantic' || result.validationKind === 'semantic';
    return {
      id: uid(),
      type: result.metadata.TYPE || (semantic ? 'semantic' : 'single-answer'),
      difficulty: result.metadata.DIFFICULTY || 'Template-defined',
      language: ['en', 'ro'].includes(String(result.metadata.LANGUAGE || '').toLowerCase())
        ? String(result.metadata.LANGUAGE).toLowerCase()
        : (state.settings.contentLanguage || 'en'),
      validationKind: semantic ? 'semantic' : 'deterministic',
      question: result.question,
      questionSegments: result.questionSegments,
      options: [],
      answer: result.formattedAnswer || String(result.answer ?? ''),
      rawAnswer: semantic ? undefined : result.answer,
      answerUnit: result.answerUnit,
      answerConfig: result.answerConfig,
      acceptedAnswers: result.acceptedAnswers || [],
      answerItems: !semantic && Array.isArray(result.answers) && result.answers.length > 1
        ? result.answers.map(item => ({
          id: item.id,
          label: item.label,
          answer: item.formattedAnswer || formatAnswer(item.answer),
          rawAnswer: item.answer,
          answerUnit: item.answerUnit,
          answerConfig: item.answerConfig,
          acceptedAnswers: item.acceptedAnswers || []
        }))
        : [],
      semanticConfig: semantic
        ? normalizeSemanticConfig(result.semanticConfig || {
          strictness: result.answerConfig?.strictness,
          referenceAnswer: result.answer
        }, result.answer)
        : null,
      requiredKeywords: [],
      hint: result.feedback.hint || (semantic
        ? 'Answer using the central ideas from the approved reference answer.'
        : 'Use the highlighted values and the supplied formula rules.'),
      explanation: result.explanation,
      variables: result.variables,
      requiredInputs: result.requiredInputs,
      calculationTrace: semantic ? null : result.trace,
      templateSeed: result.seed,
      source: 'template',
      sourceTitle: result.metadata.TITLE || template.name || els.templateName?.value?.trim() || 'Exercise template',
      sourceTemplateId: template.id || null,
      sourceTemplateName: template.name || result.metadata.TITLE || 'Exercise template',
      templateText: template.text || result.templateText || els.templateText?.value?.trim() || '',
      createdAt: new Date().toISOString()
    };
  }

function generateTemplateExercise() {
    const text = els.templateText.value.trim();
    if (!text) return toast('Template required', 'Enter or load a template first.', 'error');
    try {
      const result = instantiateTemplate(text);
      const exercise = buildExerciseFromTemplateResult(result, {
        name: els.templateName.value.trim() || result.metadata.TITLE || 'Exercise template',
        text
      });
      state.currentExercise = exercise;
      renderExerciseCard(exercise, els.templateExerciseHost);
      toast(
        'Exercise generated',
        result.kind === 'semantic'
          ? 'A semantic exercise instance was created. Gemini will grade it when available.'
          : `A reproducible template instance was created with seed ${result.seed}.`,
        'success'
      );
    } catch (error) {
      renderExerciseHostError(els.templateExerciseHost, error);
      toast('Template error', error.message, 'error');
    }
  }

function validateCurrentTemplate({ silent = false } = {}) {
    const text = els.templateText.value.trim();
    if (!text) {
      if (!silent) toast('Template required', 'Enter or load a template before validating it.', 'error');
      return null;
    }

    try {
      const parsed = parseTemplate(text);
      if (isSemanticTemplate(parsed)) {
        const instance = instantiateTemplate(parsed);
        const report = { valid: true, semantic: true, instance, issues: [] };
        lastTemplateValidation = { text, runs: 0, report };
        renderSemanticTemplateValidation(instance);
        if (!silent) {
          toast('Semantic template ready', 'The structure and reference answer are valid. Numeric randomized validation is not required.', 'success');
        }
        return report;
      }

      const runs = Number(els.templateValidationRuns.value) || 25;
      const report = validateTemplate(text, { runs });
      lastTemplateValidation = { text, runs, report };
      renderTemplateValidation(report);

      if (!silent) {
        const errors = report.issues.filter(item => item.severity === 'error').length;
        const warnings = report.issues.filter(item => item.severity === 'warning').length;
        toast(
          report.valid ? 'Template validated' : 'Template needs attention',
          report.valid
            ? `${report.trials.successes} randomized tests passed${warnings ? ` with ${warnings} warning${warnings === 1 ? '' : 's'}` : ''}.`
            : `${errors} blocking error${errors === 1 ? '' : 's'} found.`,
          report.valid ? 'success' : 'error'
        );
      }
      return report;
    } catch (error) {
      const report = { valid: false, semantic: false, issues: [{ severity: 'error', message: error.message }] };
      lastTemplateValidation = { text, runs: 0, report };
      els.templateValidationResult.className = 'template-validation-result error';
      els.templateValidationResult.innerHTML = `<div class="validation-header"><div><span class="validation-status-dot"></span><strong>Template has blocking errors</strong><p>1 error</p></div></div><div class="validation-issue-list"><div class="validation-issue error"><span>!</span><div><strong>Error</strong><p>${escapeHtml(error.message)}</p></div></div></div>`;
      if (!silent) toast('Template needs attention', error.message, 'error');
      return report;
    }
  }

function renderSemanticTemplateValidation(instance) {
    els.templateValidationResult.className = 'template-validation-result success';
    els.templateValidationResult.innerHTML = `<div class="validation-header"><div><span class="validation-status-dot"></span><strong>Semantic template is ready</strong><p>Structural check passed · numeric answer validation not required</p></div><span class="validation-run-badge">Semantic</span></div><div class="validation-stats"><div><span>Language</span><strong>${escapeHtml(instance.metadata.LANGUAGE || state.settings.contentLanguage || 'en')}</strong></div><div><span>Strictness</span><strong>${escapeHtml(instance.semanticConfig?.strictness || 'moderate')}</strong></div><div><span>Generated seed</span><strong>${escapeHtml(instance.seed)}</strong></div></div><div class="validation-empty"><span>✓</span><p>The question and authoritative reference answer can be instantiated successfully.</p></div>`;
  }

function renderTemplateValidation(report) {
    const errors = report.issues.filter(item => item.severity === 'error');
    const warnings = report.issues.filter(item => item.severity === 'warning');
    const statusClass = report.valid ? (warnings.length ? 'warning' : 'success') : 'error';
    const statusText = report.valid
      ? (warnings.length ? 'Valid with warnings' : 'Template is valid')
      : 'Template has blocking errors';
    const answerRange = report.trials.minimumAnswer == null
      ? 'No numeric answers'
      : report.trials.minimumAnswer === report.trials.maximumAnswer
        ? formatAnswer(report.trials.minimumAnswer)
        : `${formatAnswer(report.trials.minimumAnswer)} – ${formatAnswer(report.trials.maximumAnswer)}`;

    const issuesHtml = report.issues.length
      ? `<div class="validation-issue-list">${report.issues.map(item => `<div class="validation-issue ${escapeAttr(item.severity)}"><span>${item.severity === 'error' ? '!' : 'i'}</span><div><strong>${item.severity === 'error' ? 'Error' : 'Warning'}</strong><p>${escapeHtml(item.message)}</p></div></div>`).join('')}</div>`
      : '<div class="validation-empty"><span>✓</span><p>No structural or randomized-test issues were detected.</p></div>';

    const samplesHtml = report.sampleInstances.length
      ? `<div class="validation-samples"><h4>Sample calculation traces</h4>${report.sampleInstances.map((sample, index) => `<details class="trace-card"><summary>Test instance ${index + 1}: ${escapeHtml(formatAnswer(sample.answer))}</summary><div class="trace-question">${renderQuestionSegmentsHtml(sample.questionSegments, sample.question)}</div>${renderCalculationTraceHtml(sample.trace)}</details>`).join('')}</div>`
      : '';

    els.templateValidationResult.className = `template-validation-result ${statusClass}`;
    const averageAttempts = report.trials.averageAttempts == null ? '—' : Number(report.trials.averageAttempts).toFixed(1);
    els.templateValidationResult.innerHTML = `<div class="validation-header"><div><span class="validation-status-dot"></span><strong>${escapeHtml(statusText)}</strong><p>${errors.length} errors · ${warnings.length} warnings</p></div><span class="validation-run-badge">${report.trials.successes}/${report.trials.requested} tests passed</span></div><div class="validation-stats"><div><span>Unique questions</span><strong>${report.trials.uniqueQuestions}</strong></div><div><span>Average attempts</span><strong>${escapeHtml(averageAttempts)}</strong></div><div><span>Answer range</span><strong>${escapeHtml(answerRange)}</strong></div></div>${issuesHtml}${samplesHtml}`;
  }

function clearTemplateValidation() {
    lastTemplateValidation = null;
    els.templateValidationResult.className = 'template-validation-result hidden';
    els.templateValidationResult.innerHTML = '';
  }

function markTemplateValidationStale() {
    lastTemplateValidation = null;
    if (els.templateValidationResult.classList.contains('hidden')) return;
    els.templateValidationResult.className = 'template-validation-result stale';
    els.templateValidationResult.innerHTML = '<div class="validation-stale-message"><span>↻</span><div><strong>Template changed</strong><p>Run validation again to refresh the results and sample traces.</p></div></div>';
  }

function saveCurrentTemplate() {
    const name = els.templateName.value.trim() || 'Untitled template';
    const text = els.templateText.value.trim();
    if (!text) return toast('Template required', 'Enter a template before saving.', 'error');

    let parsed;
    try {
      parsed = parseTemplate(text);
      if (isSemanticTemplate(parsed)) {
        // Semantic templates need only a structural instantiation check. They do
        // not have a mathematical answer that benefits from randomized numeric validation.
        instantiateTemplate(parsed);
      } else {
        const runs = Number(els.templateValidationRuns.value) || 25;
        const report = lastTemplateValidation?.text === text && lastTemplateValidation.runs === runs
          ? lastTemplateValidation.report
          : validateCurrentTemplate({ silent: true });
        if (!report || !report.valid) {
          return toast('Template not saved', 'Resolve the validator errors before saving this mathematical template.', 'error');
        }
      }
    } catch (error) {
      return toast('Template not saved', error.message, 'error');
    }

    const existingIndex = state.templates.findIndex(item => item.name.toLowerCase() === name.toLowerCase());
    const item = {
      id: existingIndex >= 0 ? state.templates[existingIndex].id : uid(),
      name,
      text,
      kind: isSemanticTemplate(parsed) ? 'semantic' : 'deterministic',
      updatedAt: new Date().toISOString()
    };
    if (existingIndex >= 0) state.templates.splice(existingIndex, 1, item);
    else state.templates.unshift(item);
    saveState();
    renderRecentWork();
    renderQuizBuilder();
    toast(
      'Template saved',
      isSemanticTemplate(parsed)
        ? `${name} is available for semantic instances and quiz problems.`
        : `${name} is available for randomized instances and quiz problems.`,
      'success'
    );
  }

async function importTemplateFile(file) {
    if (!file) return;
    try {
      const content = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        const data = JSON.parse(content); const item = data.text ? data : data.template;
        if (!item?.text) throw new Error('The JSON file does not contain a template text field.');
        els.templateName.value = item.name || file.name.replace(/\.json$/i, ''); els.templateText.value = item.text;
      } else { els.templateName.value = file.name.replace(/\.txt$/i, ''); els.templateText.value = content; }
      clearTemplateValidation();
      switchExerciseTab('template'); toast('Template imported', 'Review it, then validate, generate, or save it.', 'success');
    } catch (error) { toast('Import failed', error.message, 'error'); }
    finally { els.templateImportFile.value = ''; }
  }

async function createDirectExercise() {
    const type = els.directType.value;
    const question = els.directQuestion.value.trim();
    const answer = els.directAnswer.value.trim();
    const language = els.directLanguage.value;
    const semantic = isSemanticType(type);
    if (!question || !answer) {
      return toast(
        semantic ? 'Question and reference answer required' : 'Question and answer required',
        semantic
          ? 'Complete the question and the authoritative reference answer before creating the exercise.'
          : 'Complete both fields before creating the exercise.',
        'error'
      );
    }

    const options = type === 'multiple-choice'
      ? els.directOptions.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
      : [];
    if (type === 'multiple-choice'
      && (options.length < 2 || !options.some(option => normalizeText(option) === normalizeText(answer)))) {
      return toast('Check multiple-choice options', 'Provide at least two options and include the correct answer.', 'error');
    }

    let semanticConfig = null;
    if (semantic) {
      const conceptMode = els.directConceptMode.value;
      semanticConfig = normalizeSemanticConfig({
        strictness: els.directSemanticStrictness.value,
        referenceAnswer: answer,
        conceptSource: conceptMode,
        essentialConcepts: splitLines(els.directEssentialConcepts.value),
        supportingConcepts: splitLines(els.directSupportingConcepts.value),
        acceptedExpressions: splitLines(els.directAcceptedExpressions.value),
        knownIncorrectClaims: splitLines(els.directIncorrectClaims.value)
      }, answer);

      if (conceptMode === 'automatic') {
        if (!ensureApiKey()) return;
        setButtonLoading(els.createDirectExerciseButton, true, 'Generating guidance…');
        try {
          const raw = await callGemini(buildConceptExtractionPrompt({ question, referenceAnswer: answer, language }), true);
          const generated = parseJsonResponse(raw);
          semanticConfig = normalizeSemanticConfig({
            ...generated,
            strictness: els.directSemanticStrictness.value,
            referenceAnswer: answer,
            conceptSource: 'automatic'
          }, answer);
        } catch (error) {
          toast('Could not generate grading guidance', friendlyApiError(error), 'error');
          setButtonLoading(els.createDirectExerciseButton, false);
          return;
        }
      }
    }

    const exercise = normalizeGeneratedExercise({
      question,
      answer,
      options,
      requiredKeywords: semantic
        ? []
        : els.directKeywords.value.split(',').map(value => value.trim()).filter(Boolean),
      semanticConfig,
      hint: els.directHint.value.trim(),
      explanation: els.directExplanation.value.trim()
    }, {
      type,
      difficulty: 'Custom',
      language,
      source: 'direct',
      strictness: semanticConfig?.strictness,
      conceptMode: semanticConfig?.conceptSource
    });

    state.currentExercise = exercise;
    renderExerciseCard(exercise, els.directExerciseHost);
    toast(
      'Exercise created',
      semantic
        ? 'The semantic exercise is ready. Gemini will grade learner answers against the reference answer.'
        : 'The direct exercise is ready to answer or save in the exercise library.',
      'success'
    );
    setButtonLoading(els.createDirectExerciseButton, false);
  }

function splitLines(value) {
  return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
}

function hasMultipleAnswers(exercise) {
  return Array.isArray(exercise?.answerItems) && exercise.answerItems.length > 1;
}

function renderAnswerInputs(exercise, { radioName = 'answer', savedAnswer = '' } = {}) {
  if (exercise.type === 'multiple-choice') {
    return `<div class="option-list">${(exercise.options || []).map(option => `<label class="option-card"><input type="radio" name="${escapeAttr(radioName)}" value="${escapeAttr(option)}" ${savedAnswer === option ? 'checked' : ''}><span>${escapeHtml(option)}</span></label>`).join('')}</div>`;
  }
  if (hasMultipleAnswers(exercise)) {
    const saved = savedAnswer && typeof savedAnswer === 'object' ? savedAnswer : {};
    return `<div class="multi-answer-list">${exercise.answerItems.map((item, index) => `<label class="multi-answer-field"><span>${escapeHtml(item.label || `Answer ${index + 1}`)}</span><input class="input" data-role="answer-input" data-answer-id="${escapeAttr(item.id)}" value="${escapeAttr(saved[item.id] || '')}" placeholder="Enter answer${item.answerUnit ? ` in ${escapeAttr(item.answerUnit)}` : ''}"></label>`).join('')}</div>`;
  }
  return `<textarea class="textarea" data-role="answer-input" placeholder="${isSemanticExercise(exercise) ? 'Write the most valid answer you can…' : 'Enter your answer…'}">${escapeHtml(typeof savedAnswer === 'string' ? savedAnswer : '')}</textarea>`;
}

function formatAnswerKey(exercise) {
  if (!hasMultipleAnswers(exercise)) {
    return `${isSemanticExercise(exercise) ? 'Reference answer' : 'Answer'}: ${exercise.answer}`;
  }
  return ['Answers:', ...exercise.answerItems.map((item, index) => `${index + 1}. ${item.label || `Answer ${index + 1}`}: ${item.answer}`)].join('\n');
}

function renderExerciseCard(exercise, host) {
    host.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'exercise-card';
    const semantic = isSemanticExercise(exercise);
    const multiAnswer = hasMultipleAnswers(exercise);
    const optionHtml = renderAnswerInputs(exercise, {
      radioName: `exercise-answer-${exercise.id}`,
      savedAnswer: ''
    });
    const variableHtml = !exercise.questionSegments && exercise.variables
      ? `<div class="exercise-variable-list">${Object.entries(exercise.variables).filter(([key]) => key !== 'ANSWER').map(([key, value]) => `<span>${escapeHtml(key)} = ${escapeHtml(formatAnswer(value))}</span>`).join('')}</div>`
      : '';
    const traceAction = exercise.calculationTrace
      ? '<button class="button secondary" data-action="trace">Calculation trace</button>'
      : '';
    const valueLegend = renderValueHighlightLegend(exercise);
    const seedPill = exercise.templateSeed === undefined ? '' : `<span class="meta-pill">Seed ${escapeHtml(exercise.templateSeed)}</span>`;
    const languagePill = `<span class="meta-pill">${escapeHtml(getLanguageName(exercise.language || 'en', state.settings.uiLanguage || 'en'))}</span>`;
    const semanticPill = semantic
      ? `<span class="meta-pill semantic-pill">${escapeHtml(exercise.semanticConfig?.strictness || 'moderate')} semantic</span>`
      : '';
    const semanticNotice = semantic
      ? `<div class="semantic-grading-notice ${getApiKey() ? 'ready' : 'unavailable'}"><span>${getApiKey() ? '◇' : '!'}</span><div><strong>Semantic evaluation</strong><p>${getApiKey() ? 'Gemini will compare the learner answer with the approved reference answer according to the selected strictness.' : 'Gemini is unavailable, so this exercise can be answered but cannot be graded.'}</p></div></div>`
      : '';
    const guidanceHtml = semantic ? renderSemanticGuidance(exercise.semanticConfig) : '';

    wrapper.innerHTML = `<div class="exercise-meta"><span class="meta-pill">${escapeHtml(humanizeType(exercise.type))}</span><span class="meta-pill">${escapeHtml(exercise.difficulty)}</span><span class="meta-pill">${escapeHtml(exercise.source)}</span>${languagePill}${semanticPill}${seedPill}</div><div class="exercise-question">${renderExerciseQuestion(exercise)}</div>${valueLegend}${semanticNotice}${guidanceHtml}${variableHtml}<div class="answer-area">${optionHtml}<div class="answer-feedback hidden" data-role="feedback"></div><div class="exercise-actions"><button class="button primary" data-action="check">Check answer</button><button class="button secondary" data-action="hint">Hint</button><button class="button secondary" data-action="solution">Show solution</button>${traceAction}<button class="button ghost" data-action="save">Save</button><button class="button ghost" data-action="export">Export JSON</button></div><p class="exercise-template-note">Quiz problems now use saved templates directly and generate fresh values when the quiz starts.</p></div>`;
    host.appendChild(wrapper);
    wrapper.querySelector('[data-action="check"]').addEventListener('click', () => checkExerciseAnswer(exercise, wrapper));
    wrapper.querySelector('[data-action="hint"]').addEventListener('click', () => showExerciseFeedback(wrapper, 'neutral', exercise.hint || 'No hint was supplied for this exercise.'));
    wrapper.querySelector('[data-action="solution"]').addEventListener('click', () => showExerciseFeedback(wrapper, 'neutral', `${multiAnswer ? formatAnswerKey(exercise) : `${semantic ? 'Reference answer' : 'Answer'}: ${exercise.answer}`}${exercise.explanation ? `\n\n${exercise.explanation}` : ''}`));
    wrapper.querySelector('[data-action="trace"]')?.addEventListener('click', () => showExerciseFeedback(wrapper, 'neutral', exercise.explanation || 'No calculation trace is available.'));
    wrapper.querySelector('[data-action="save"]').addEventListener('click', () => saveExercise(exercise));
    wrapper.querySelector('[data-action="export"]').addEventListener('click', () => downloadJson(`${slugify(exercise.sourceTitle || 'exercise')}.json`, exercise));
    scheduleInterfaceTranslation();
  }

function renderSemanticGuidance(config) {
  if (!config) return '';
  const groups = [
    ['Essential concepts', config.essentialConcepts],
    ['Supporting concepts', config.supportingConcepts],
    ['Accepted expressions', config.acceptedExpressions],
    ['Known incorrect claims', config.knownIncorrectClaims]
  ].filter(([, values]) => Array.isArray(values) && values.length);
  if (!groups.length) return '';
  return `<details class="semantic-guidance"><summary>Generated grading guidance</summary><div>${groups.map(([label, values]) => `<section><strong>${escapeHtml(label)}</strong><ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>`).join('')}</div></details>`;
  }

function renderExerciseQuestion(exercise) {
    return renderQuestionSegmentsHtml(exercise.questionSegments, exercise.question);
  }

function renderValueHighlightLegend(exercise) {
    const hasRequiredValues = Array.isArray(exercise.questionSegments)
      && exercise.questionSegments.some(segment => segment.type === 'value' && segment.required);
    return hasRequiredValues
      ? '<div class="exercise-value-legend"><span></span>Highlighted values are required for the solution.</div>'
      : '';
  }

function renderQuestionSegmentsHtml(segments, fallbackQuestion = '') {
    if (!Array.isArray(segments) || !segments.length) return escapeHtml(fallbackQuestion);

    return segments.map(segment => {
      if (segment.type !== 'value') return escapeHtml(segment.text);
      if (!segment.required) return `<span class="exercise-given-value optional-value" title="${escapeAttr(segment.variable || 'Generated value')}">${escapeHtml(segment.text)}</span>`;
      return `<mark class="exercise-given-value" title="Required value: ${escapeAttr(segment.variable || '')}">${escapeHtml(segment.text)}</mark>`;
    }).join('');
  }

function renderCalculationTraceHtml(trace) {
    if (!trace) return '';

    const inputs = (trace.inputs || []).filter(input => input.required).map(input => `<div class="trace-row"><span>${escapeHtml(input.name)}</span><code>${escapeHtml(formatAnswer(input.value))}</code><b>required</b></div>`).join('');
    const mappings = (trace.mappings || []).flatMap(mapping => mapping.outputs.filter(output => output.required).map(output => `<div class="trace-step"><span>${escapeHtml(output.name)}</span><code>map(${escapeHtml(mapping.sourceName)} = ${escapeHtml(formatAnswer(mapping.sourceValue))})</code><strong>${escapeHtml(formatAnswer(output.value))}</strong></div>`)).join('');
    const assignments = (trace.assignments || []).filter(step => step.required).map(step => `<div class="trace-step"><span>${escapeHtml(step.name)}</span><code>${escapeHtml(step.expression)}</code><code>${escapeHtml(step.substitutedExpression)}</code><strong>${escapeHtml(formatAnswer(step.value))}</strong></div>`).join('');

    const constraints = (trace.constraints || []).map(item => `<div class="trace-step"><span>${item.passed ? 'PASS' : 'FAIL'}</span><code>${escapeHtml(item.expression)}</code><code>${escapeHtml(item.substitutedExpression || '')}</code><strong>${item.passed ? 'true' : 'false'}</strong></div>`).join('');
    const seedInfo = trace.seed === undefined ? '' : `<div class="trace-seed"><span>Seed <strong>${escapeHtml(trace.seed)}</strong></span><span>Accepted attempt <strong>${escapeHtml(trace.attempt || 1)}</strong></span></div>`;
    const answerDetails = Array.isArray(trace.answerDetails) && trace.answerDetails.length > 1
      ? `<div class="trace-answer-list">${trace.answerDetails.map((item, index) => `<div class="trace-answer"><span>${escapeHtml(item.label || `Answer ${index + 1}`)}</span><strong>${escapeHtml(item.formattedAnswer || formatAnswer(item.answer))}</strong></div>`).join('')}</div>`
      : `<div class="trace-answer"><span>Final answer</span><strong>${escapeHtml(trace.formattedAnswer || formatAnswer(trace.answer))}</strong></div>`;
    return `<div class="calculation-trace">${seedInfo}<section><h5>Generated inputs</h5><div class="trace-inputs">${inputs || '<p>No input definitions.</p>'}</div></section>${mappings ? `<section><h5>Mappings</h5><div class="trace-steps">${mappings}</div></section>` : ''}<section><h5>Formula evaluation</h5><div class="trace-steps">${assignments || '<p>No assignments.</p>'}</div></section>${constraints ? `<section><h5>Constraints</h5><div class="trace-steps">${constraints}</div></section>` : ''}${answerDetails}</div>`;
  }

async function checkExerciseAnswer(exercise, wrapper) {
    const answer = getAnswerFromExerciseUI(exercise, wrapper);
    if (!answer) return showExerciseFeedback(wrapper, 'incorrect', t('answerRequired', state.settings.uiLanguage));
    const button = wrapper.querySelector('[data-action="check"]'); setButtonLoading(button, true, 'Checking…');
    try { const result = await evaluateAnswer(exercise, answer); showExerciseFeedback(wrapper, result.gradable === false ? 'ungradable' : result.correct ? 'correct' : 'incorrect', result.message); }
    catch (error) { showExerciseFeedback(wrapper, 'incorrect', friendlyApiError(error)); }
    finally { setButtonLoading(button, false); }
  }

function getAnswerFromExerciseUI(exercise, wrapper) {
    if (exercise.type === 'multiple-choice') {
      return wrapper.querySelector(`input[name="exercise-answer-${CSS.escape(exercise.id)}"]:checked`)?.value || '';
    }
    if (hasMultipleAnswers(exercise)) {
      const values = {};
      wrapper.querySelectorAll('[data-role="answer-input"][data-answer-id]').forEach(input => {
        values[input.dataset.answerId] = input.value.trim();
      });
      return Object.values(values).some(Boolean) ? values : '';
    }
    return wrapper.querySelector('[data-role="answer-input"]')?.value.trim() || '';
  }
function showExerciseFeedback(wrapper, type, message) { const feedback = wrapper.querySelector('[data-role="feedback"]'); feedback.className = `answer-feedback ${type}`; feedback.textContent = message; }
function saveExercise(exercise) {
    if (state.exercises.some(item => item.id === exercise.id)) return toast('Already saved', 'This exercise is already in your library.', 'info');
    state.exercises.unshift(clone(exercise)); saveState(); renderRecentWork(); toast('Exercise saved', 'The exercise was added to your local library.', 'success');
  }
function setExerciseHostLoading(host) { host.innerHTML = '<div class="loading-state"><div><div class="loading-spinner"></div><strong>Creating one focused exercise</strong><p>Gemini is designing the question, answer, and feedback.</p></div></div>'; }
function renderExerciseHostError(host, error) { host.innerHTML = `<div class="empty-state"><span>!</span><strong>Exercise creation failed</strong><p>${escapeHtml(friendlyApiError(error))}</p></div>`; }

function bindQuizControls() {
    els.addQuizProblemButton.addEventListener('click', addQuizProblem);
    els.startQuizButton.addEventListener('click', startQuiz);
    els.clearQuizButton.addEventListener('click', () => confirmAction('Clear current quiz?', 'All problem slots will be removed from the current quiz draft.', () => { state.quizDraft = []; saveState(); renderQuizBuilder(); }));
    els.saveQuizButton.addEventListener('click', saveCurrentQuiz);
    els.exportQuizTxtButton.addEventListener('click', exportQuizTxt);
    els.exportQuizJsonButton.addEventListener('click', exportQuizJson);
  }

function addQuizProblem() {
    if (!state.templates.length) {
      return toast('Save a template first', 'Quiz problem candidates are generated from templates in your local library.', 'error');
    }
    state.quizDraft.push(createQuizProblem([]));
    saveState();
    renderQuizBuilder();
  }

function getSavedTemplateKind(template) {
    if (template.kind) return template.kind;
    try { return isSemanticTemplate(template.text) ? 'semantic' : 'deterministic'; }
    catch { return 'invalid'; }
  }

function renderQuizBuilder() {
    const problems = normalizeQuizProblems(state.quizDraft, state.templates, state.exercises);
    state.quizDraft = problems;
    els.quizNavCount.textContent = problems.length;
    els.quizItemCount.textContent = problems.length;

    if (!problems.length) {
      els.quizBuilderList.className = 'empty-state';
      els.quizBuilderList.innerHTML = '<span>✓</span><strong>Your quiz has no problems</strong><p>Save templates in Exercise Lab, then add a problem and select one or more template candidates.</p>';
      return;
    }

    const templateOptions = state.templates.map(template => ({
      id: template.id,
      label: `${template.name} · ${getSavedTemplateKind(template) === 'semantic' ? 'semantic' : 'randomized calculation'}`
    }));

    els.quizBuilderList.className = '';
    els.quizBuilderList.innerHTML = problems.map((problem, index) => {
      const selected = new Set(problem.candidateTemplateIds || []);
      const optionMap = new Map(templateOptions.map(option => [option.id, option]));
      for (const candidateId of selected) {
        if (optionMap.has(candidateId)) continue;
        const snapshot = problem.templateSnapshots?.[candidateId];
        if (snapshot) optionMap.set(candidateId, {
          id: candidateId,
          label: `Archived template — ${snapshot.name || 'Untitled template'}`
        });
      }
      const options = [...optionMap.values()].map(option => `<option value="${escapeAttr(option.id)}" ${selected.has(option.id) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('');
      const candidates = getProblemCandidates(problem, state.templates, state.exercises);
      const candidateCount = candidates.length;
      const legacyCount = candidates.filter(candidate => candidate.kind === 'exercise').length;
      return `<div class="quiz-problem-card" data-index="${index}">
        <span class="drag-handle" title="Reorder problem">⋮⋮</span>
        <div class="quiz-problem-main">
          <div class="quiz-problem-header"><h4>Problem ${index + 1}</h4><span>${candidateCount} candidate${candidateCount === 1 ? '' : 's'}</span></div>
          <select class="quiz-candidate-select" data-role="candidate-select" multiple aria-label="Candidate templates for problem ${index + 1}">${options}</select>
          <p class="quiz-problem-help">Hold Ctrl or Cmd to select multiple templates. One template is chosen randomly and instantiated with fresh allowed values when the quiz starts.</p>
          ${legacyCount ? `<div class="quiz-problem-empty">This migrated problem also contains ${legacyCount} archived fixed exercise candidate${legacyCount === 1 ? '' : 's'}.</div>` : ''}
          ${candidateCount ? '' : '<div class="quiz-problem-empty">Select at least one candidate template.</div>'}
        </div>
        <div class="quiz-item-actions"><button data-move="up" title="Move up">↑</button><button data-move="down" title="Move down">↓</button><button data-remove title="Remove problem">×</button></div>
      </div>`;
    }).join('');

    els.quizBuilderList.querySelectorAll('[data-index]').forEach(row => {
      const index = Number(row.dataset.index);
      row.querySelector('[data-role="candidate-select"]').addEventListener('change', event => {
        const candidateIds = [...event.target.selectedOptions].map(option => option.value);
        state.quizDraft[index] = setProblemCandidates(state.quizDraft[index], candidateIds, state.templates);
        saveState();
        renderQuizBuilder();
      });
      row.querySelector('[data-move="up"]').addEventListener('click', () => moveQuizItem(index, -1));
      row.querySelector('[data-move="down"]').addEventListener('click', () => moveQuizItem(index, 1));
      row.querySelector('[data-remove]').addEventListener('click', () => {
        state.quizDraft.splice(index, 1);
        saveState();
        renderQuizBuilder();
      });
    });
  }

function moveQuizItem(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= state.quizDraft.length) return;
    [state.quizDraft[index], state.quizDraft[target]] = [state.quizDraft[target], state.quizDraft[index]];
    saveState();
    renderQuizBuilder();
  }

function getQuizDraftObject() {
    return {
      id: uid(),
      title: els.quizTitle.value.trim() || 'Practice session',
      feedbackTiming: els.quizFeedbackTiming.value,
      feedbackDepth: els.quizFeedbackDepth.value,
      shuffle: els.quizShuffle.checked,
      problems: clone(state.quizDraft),
      createdAt: new Date().toISOString()
    };
  }

function validateCurrentQuizDraft() {
    const issues = validateQuizProblems(state.quizDraft, state.templates, state.exercises);
    if (!issues.length) return true;
    toast('Quiz needs attention', issues[0], 'error');
    return false;
  }

function saveCurrentQuiz() {
    if (!validateCurrentQuizDraft()) return;
    state.quizzes.unshift(getQuizDraftObject());
    saveState();
    toast('Quiz saved', 'The randomized quiz blueprint was added to your library.', 'success');
  }

function createResolvedQuiz(blueprint = getQuizDraftObject()) {
    const exercises = resolveQuizProblems(blueprint.problems || [], state.templates, {
      exerciseLibrary: state.exercises,
      instantiateTemplate,
      buildExercise: buildExerciseFromTemplateResult
    });
    return {
      ...clone(blueprint),
      blueprintId: blueprint.id,
      exercises: blueprint.shuffle ? shuffleArray(exercises) : exercises,
      generatedAt: new Date().toISOString()
    };
  }

function exportQuizTxt() {
    if (!validateCurrentQuizDraft()) return;
    const quiz = createResolvedQuiz();
    const text = [
      quiz.title,
      '='.repeat(quiz.title.length),
      `Generated: ${new Date(quiz.generatedAt).toLocaleString()}`,
      '',
      ...quiz.exercises.flatMap((exercise, index) => [
        `${index + 1}. ${exercise.question}`,
        ...(exercise.options?.length ? exercise.options.map((option, optionIndex) => `   ${String.fromCharCode(65 + optionIndex)}. ${option}`) : []),
        '',
        ...formatAnswerKey(exercise).split('\n'),
        exercise.explanation ? `Explanation: ${exercise.explanation}` : '',
        ''
      ])
    ].filter(Boolean).join('\n');
    downloadText(`${slugify(quiz.title)}.txt`, text);
  }

function exportQuizJson() {
    if (!validateCurrentQuizDraft()) return;
    downloadJson(`${slugify(els.quizTitle.value || 'quiz')}.json`, getQuizDraftObject());
  }

function startQuiz() {
    if (!validateCurrentQuizDraft()) return;
    let quiz;
    try {
      quiz = createResolvedQuiz();
    } catch (error) {
      return toast('Could not build quiz', error.message, 'error');
    }
    quizSession = {
      quiz,
      index: 0,
      responses: quiz.exercises.map(() => ({ answer: '', result: null })),
      awaitingNext: false,
      completed: false
    };
    els.quizModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderQuizPlayer();
  }

function renderQuizPlayer() {
    if (!quizSession) return;
    if (quizSession.completed) return renderQuizResults();
    const { quiz, index } = quizSession;
    const exercise = quiz.exercises[index];
    const response = quizSession.responses[index];
    const language = state.settings.uiLanguage || 'en';
    els.quizModalTitle.textContent = quiz.title;
    els.quizProgressLabel.textContent = t('problemOf', language, { current: index + 1, total: quiz.exercises.length });
    els.quizProgressBar.style.width = `${((index + 1) / quiz.exercises.length) * 100}%`;
    const answersHtml = renderAnswerInputs(exercise, {
      radioName: 'quiz-answer',
      savedAnswer: response.answer
    });
    const feedbackClass = !response.result
      ? 'hidden'
      : response.result.gradable === false
        ? 'ungradable'
        : response.result.correct
          ? 'correct'
          : 'incorrect';
    const semanticNotice = isSemanticExercise(exercise)
      ? `<div class="semantic-grading-notice ${getApiKey() ? 'ready' : 'unavailable'}"><span>${getApiKey() ? '◇' : '!'}</span><div><strong>Semantic evaluation</strong><p>${getApiKey() ? 'Gemini evaluates this answer against its reference answer and strictness level.' : t('semanticRequiresGemini', language)}</p></div></div>`
      : '';
    els.quizPlayerBody.innerHTML = `<div class="exercise-meta"><span class="meta-pill">${escapeHtml(humanizeType(exercise.type))}</span><span class="meta-pill">${escapeHtml(exercise.difficulty)}</span><span class="meta-pill">${escapeHtml(getLanguageName(exercise.language || 'en', language))}</span>${isSemanticExercise(exercise) ? `<span class="meta-pill semantic-pill">${escapeHtml(exercise.semanticConfig?.strictness || 'moderate')} semantic</span>` : ''}</div><div class="exercise-question">${renderExerciseQuestion(exercise)}</div>${renderValueHighlightLegend(exercise)}${semanticNotice}${answersHtml}<div class="answer-feedback ${feedbackClass}" id="quizAnswerFeedback">${response.result ? escapeHtml(formatFeedbackForDepth(exercise, response.result, quiz.feedbackDepth)) : ''}</div>`;
    els.quizPreviousButton.disabled = index === 0;
    els.quizPreviousButton.classList.toggle('hidden', quiz.feedbackTiming === 'immediate' && quizSession.awaitingNext);
    els.quizSubmitButton.classList.toggle('hidden', quizSession.awaitingNext);
    els.quizNextButton.classList.toggle('hidden', !quizSession.awaitingNext);
    els.quizNextButton.textContent = index === quiz.exercises.length - 1 ? t('finishQuiz', language) : t('nextProblem', language);
    scheduleInterfaceTranslation();
  }

function closeQuizModal() { els.quizModal.classList.add('hidden'); document.body.style.overflow = ''; quizSession = null; }
function saveCurrentQuizResponse() {
    if (!quizSession || quizSession.completed) return '';
    const exercise = quizSession.quiz.exercises[quizSession.index];
    let answer = '';
    if (exercise.type === 'multiple-choice') {
      answer = els.quizPlayerBody.querySelector('input[name="quiz-answer"]:checked')?.value || '';
    } else if (hasMultipleAnswers(exercise)) {
      const values = {};
      els.quizPlayerBody.querySelectorAll('[data-role="answer-input"][data-answer-id]').forEach(input => {
        values[input.dataset.answerId] = input.value.trim();
      });
      answer = Object.values(values).some(Boolean) ? values : '';
    } else {
      answer = els.quizPlayerBody.querySelector('[data-role="answer-input"]')?.value.trim() || '';
    }
    quizSession.responses[quizSession.index].answer = answer;
    return answer;
  }

async function submitQuizAnswer() {
    if (!quizSession) return; const answer = saveCurrentQuizResponse();
    if (!answer) return toast('Answer required', 'Enter or select an answer before continuing.', 'error');
    const exercise = quizSession.quiz.exercises[quizSession.index]; setButtonLoading(els.quizSubmitButton, true, 'Checking…');
    try {
      quizSession.responses[quizSession.index].result = await evaluateAnswer(exercise, answer);
      if (quizSession.quiz.feedbackTiming === 'immediate') { quizSession.awaitingNext = true; renderQuizPlayer(); }
      else if (quizSession.index >= quizSession.quiz.exercises.length - 1) await finishQuiz();
      else { quizSession.index += 1; renderQuizPlayer(); }
    } catch (error) { toast('Could not validate answer', friendlyApiError(error), 'error'); }
    finally { setButtonLoading(els.quizSubmitButton, false); }
  }

async function finishQuiz() {
    if (!quizSession || quizSession.completed) return;
    for (let index = 0; index < quizSession.responses.length; index += 1) {
      const response = quizSession.responses[index];
      if (response.answer && !response.result) {
        response.result = await evaluateAnswer(quizSession.quiz.exercises[index], response.answer);
      }
    }
    quizSession.completed = true;
    const graded = quizSession.responses.filter(response => response.result?.gradable !== false && response.result).length;
    const ungradable = quizSession.responses.filter(response => response.result?.gradable === false).length;
    const correct = quizSession.responses.filter(response => response.result?.gradable !== false && response.result?.correct).length;
    state.attempts.unshift({
      id: uid(),
      quizTitle: quizSession.quiz.title,
      score: correct,
      total: quizSession.quiz.exercises.length,
      graded,
      ungradable,
      responses: clone(quizSession.responses),
      exercises: clone(quizSession.quiz.exercises),
      completedAt: new Date().toISOString()
    });
    saveState();
    renderQuizResults();
  }

function renderQuizResults() {
    const { quiz, responses } = quizSession;
    const language = state.settings.uiLanguage || 'en';
    const graded = responses.filter(response => response.result?.gradable !== false && response.result).length;
    const ungradable = responses.filter(response => response.result?.gradable === false).length;
    const correct = responses.filter(response => response.result?.gradable !== false && response.result?.correct).length;
    const percentage = graded ? Math.round((correct / graded) * 100) : 0;
    els.quizProgressLabel.textContent = t('quizComplete', language);
    els.quizProgressBar.style.width = '100%';
    els.quizPlayerBody.innerHTML = `<div class="empty-state compact"><span>✓</span><strong>${escapeHtml(t('gradedScore', language, { correct, graded, ungradable }))}</strong><p>${escapeHtml(graded ? t('scoredPercent', language, { percentage }) : t('noApiSemantic', language))}</p></div><div>${quiz.exercises.map((exercise, index) => {
      const response = responses[index];
      const resultClass = response.result?.gradable === false ? 'ungradable' : response.result?.correct ? 'correct' : 'incorrect';
      return `<div class="answer-feedback ${resultClass}"><strong>${index + 1}. ${escapeHtml(truncate(exercise.question, 110))}</strong><br>${escapeHtml(t('yourAnswer', language))}: ${escapeHtml(formatProvidedAnswer(response.answer) || t('noAnswer', language))}<br>${escapeHtml(formatFeedbackForDepth(exercise, response.result || { gradable: true, correct: false }, quiz.feedbackDepth))}</div>`;
    }).join('')}</div>`;
    els.quizPreviousButton.classList.add('hidden');
    els.quizSubmitButton.classList.add('hidden');
    els.quizNextButton.classList.remove('hidden');
    els.quizNextButton.textContent = t('closeQuiz', language);
    scheduleInterfaceTranslation();
  }

function formatFeedbackForDepth(exercise, result, depth) {
    const language = state.settings.uiLanguage || 'en';
    if (result.gradable === false) return result.message || t('noApiSemantic', language);
    const status = result.correct ? t('correct', language) : t('incorrect', language);
    if (depth === 'correctness') return status;
    if (depth === 'hint') return `${status}${exercise.hint ? ` Hint: ${exercise.hint}` : ''}`;
    if (depth === 'answer') return `${status} ${formatAnswerKey(exercise)}`;
    const semanticDetails = result.method === 'semantic'
      ? [
          result.message,
          result.missingConcepts?.length ? `Missing: ${result.missingConcepts.join(', ')}` : '',
          result.incorrectClaims?.length ? `Incorrect claims: ${result.incorrectClaims.join(', ')}` : ''
        ].filter(Boolean).join(' ')
      : '';
    const answerKey = formatAnswerKey(exercise);
    const multiDetails = result.method === 'multi-answer' && result.message ? ` ${result.message}` : '';
    return `${status} ${answerKey}${exercise.explanation ? ` Explanation: ${exercise.explanation}` : ''}${semanticDetails ? ` Feedback: ${semanticDetails}` : ''}${multiDetails}`;
  }

function formatProvidedAnswer(answer) {
    if (answer && typeof answer === 'object') {
      return Object.values(answer).filter(Boolean).join(' · ');
    }
    return String(answer || '');
  }

async function evaluateAnswer(exercise, userAnswer) {
    if (hasMultipleAnswers(exercise)) return evaluateMultipleAnswers(exercise, userAnswer);
    return evaluateSingleAnswer(exercise, userAnswer);
  }

async function evaluateMultipleAnswers(exercise, userAnswer) {
    const answers = userAnswer && typeof userAnswer === 'object' ? userAnswer : {};
    const parts = [];
    for (let index = 0; index < exercise.answerItems.length; index += 1) {
      const item = exercise.answerItems[index];
      const provided = answers[item.id] || '';
      const result = await evaluateSingleAnswer({
        ...exercise,
        type: 'single-answer',
        validationKind: 'deterministic',
        answerItems: [],
        answer: item.answer,
        rawAnswer: item.rawAnswer,
        answerUnit: item.answerUnit,
        answerConfig: item.answerConfig || exercise.answerConfig,
        acceptedAnswers: item.acceptedAnswers || []
      }, provided);
      parts.push({
        id: item.id,
        label: item.label || `Answer ${index + 1}`,
        expected: item.answer,
        provided,
        ...result
      });
    }
    const correct = parts.filter(part => part.correct).length;
    const total = parts.length;
    const missing = parts.filter(part => !part.provided).length;
    return {
      gradable: true,
      correct: correct === total,
      score: correct,
      total,
      missing,
      parts,
      method: 'multi-answer',
      message: [
        `${correct} of ${total} answers correct.`,
        ...parts.map((part, index) => `${index + 1}. ${part.label}: ${part.correct ? 'Correct' : `Incorrect — expected ${part.expected}`}`)
      ].join('\n')
    };
  }

async function evaluateSingleAnswer(exercise, userAnswer) {
    const expected = String(exercise.answer ?? '').trim();
    const provided = String(userAnswer ?? '').trim();
    if (!provided) return { gradable: true, correct: false, message: 'No answer was provided.', method: 'empty' };

    if (isSemanticExercise(exercise)) {
      if (!getApiKey()) {
        return {
          gradable: false,
          correct: null,
          message: t('noApiSemantic', state.settings.uiLanguage),
          method: 'unavailable'
        };
      }
      return semanticValidate(exercise, provided);
    }

    const acceptedAnswers = [expected, ...(exercise.acceptedAnswers || [])].filter(Boolean);
    if (acceptedAnswers.some(value => normalizeText(provided) === normalizeText(value))) {
      return { gradable: true, correct: true, message: 'Correct.', method: 'exact' };
    }

    const equivalence = exercise.answerConfig?.equivalence || 'combined';
    const tolerance = exercise.answerConfig?.tolerance ?? (Number(state.settings.numericTolerance) || 0.0001);
    const toleranceType = exercise.answerConfig?.toleranceType || 'relative';
    if (['numeric', 'combined'].includes(equivalence)) {
      for (const accepted of acceptedAnswers) {
        const numericResult = compareNumericAnswers(provided, accepted, Number(tolerance), toleranceType);
        if (numericResult === true) {
          return { gradable: true, correct: true, message: 'Correct — the values are numerically equivalent.', method: 'numeric' };
        }
      }
    }

    if (['symbolic', 'combined'].includes(equivalence) && acceptedAnswers.some(accepted =>
      looksLikeExpression(provided)
      && looksLikeExpression(accepted)
      && areExpressionsEquivalent(provided, accepted)
    )) {
      return { gradable: true, correct: true, message: 'Correct — the expressions are equivalent.', method: 'expression' };
    }

    const keywords = exercise.requiredKeywords || [];
    const keywordResult = checkKeywords(provided, keywords);
    if (keywords.length) {
      return keywordResult.passed
        ? { gradable: true, correct: true, message: 'Accepted by the local concept check.', method: 'keywords' }
        : { gradable: true, correct: false, message: `The response is missing essential concept${keywordResult.missing.length === 1 ? '' : 's'}: ${keywordResult.missing.join(', ')}.`, method: 'keywords' };
    }

    return { gradable: true, correct: false, message: 'Incorrect. You can request a hint or show the solution.', method: 'local' };
  }

async function semanticValidate(exercise, userAnswer) {
    const prompt = buildSemanticEvaluationPrompt({ exercise, learnerAnswer: userAnswer });
    const parsed = parseJsonResponse(await callGemini(prompt, true));
    return normalizeSemanticEvaluation(parsed, exercise.language || 'en');
  }

function bindLibraryControls() {
    document.querySelectorAll('[data-library-tab]').forEach(button => button.addEventListener('click', () => {
      activeLibraryTab = button.dataset.libraryTab;
      document.querySelectorAll('[data-library-tab]').forEach(item => item.classList.toggle('active', item.dataset.libraryTab === activeLibraryTab)); renderLibrary();
    }));
    els.exportWorkspaceButton.addEventListener('click', exportWorkspace);
  }

function renderLibrary() {
    const data = state[activeLibraryTab] || [];
    if (!data.length) { els.libraryContent.innerHTML = `<div class="empty-state"><span>▣</span><strong>No ${escapeHtml(activeLibraryTab)} saved</strong><p>Items you save will appear here and remain available in this browser.</p></div>`; return; }
    els.libraryContent.innerHTML = `<div class="library-grid">${data.map(item => renderLibraryCard(item, activeLibraryTab)).join('')}</div>`;
    els.libraryContent.querySelectorAll('[data-library-action]').forEach(button => button.addEventListener('click', () => handleLibraryAction(button.dataset.libraryAction, button.dataset.id, activeLibraryTab)));
  }

function renderLibraryCard(item, type) {
    const date = formatDate(item.createdAt || item.updatedAt || item.completedAt); const title = item.title || item.name || item.quizTitle || 'Untitled';
    const singular = { summaries: 'summary', exercises: 'exercise', templates: 'template', quizzes: 'quiz', attempts: 'attempt' }[type] || type;
    let description = '';
    if (type === 'summaries') description = stripMarkdown(item.content || '');
    if (type === 'exercises') description = item.question || '';
    if (type === 'templates') description = item.text || '';
    if (type === 'quizzes') description = `${item.problems?.length || item.exercises?.length || 0} problems · randomized candidates · ${humanizeType(item.feedbackTiming || '')} feedback`;
    if (type === 'attempts') { const graded = item.graded ?? item.total; const ungradable = item.ungradable || 0; description = `Score: ${item.score}/${graded} graded${ungradable ? ` · ${ungradable} ungradable` : ''}${graded ? ` (${Math.round((item.score / graded) * 100)}%)` : ''}`; }
    return `<article class="library-card"><span class="meta-pill">${escapeHtml(singular)}</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p><div class="library-card-footer"><span>${escapeHtml(date)}</span><div class="library-card-actions"><button data-library-action="open" data-id="${escapeAttr(item.id)}">Open</button><button data-library-action="export" data-id="${escapeAttr(item.id)}">Export</button><button data-library-action="delete" data-id="${escapeAttr(item.id)}">Delete</button></div></div></article>`;
  }

function handleLibraryAction(action, id, type) {
    const collection = state[type]; const item = collection.find(entry => entry.id === id); if (!item) return;
    if (action === 'delete') return confirmAction('Delete saved item?', 'This item will be removed from the local browser library.', () => { state[type] = collection.filter(entry => entry.id !== id); saveState(); renderLibrary(); renderRecentWork(); });
    if (action === 'export') return downloadJson(`${slugify(item.title || item.name || item.quizTitle || type)}.json`, item);
    if (action === 'open') openLibraryItem(item, type);
  }

function openLibraryItem(item, type) {
    if (type === 'summaries') { state.currentSummary = clone(item); renderSummaryOutput(); navigateTo('summary'); }
    else if (type === 'exercises') {
      state.currentExercise = clone(item); const tab = item.source === 'template' ? 'template' : item.source === 'direct' ? 'direct' : 'ai'; switchExerciseTab(tab);
      const host = tab === 'template' ? els.templateExerciseHost : tab === 'direct' ? els.directExerciseHost : els.aiExerciseHost; renderExerciseCard(item, host); navigateTo('exercise');
    } else if (type === 'templates') { els.templateName.value = item.name; els.templateText.value = item.text; clearTemplateValidation(); switchExerciseTab('template'); navigateTo('exercise'); }
    else if (type === 'quizzes') {
      state.quizDraft = normalizeQuizProblems(item.problems || item.exercises || [], state.templates, state.exercises);
      els.quizTitle.value = item.title || 'Practice session';
      els.quizFeedbackTiming.value = item.feedbackTiming || 'immediate';
      els.quizFeedbackDepth.value = item.feedbackDepth || 'correctness';
      els.quizShuffle.checked = Boolean(item.shuffle);
      saveState(); renderQuizBuilder(); navigateTo('quiz');
    } else if (type === 'attempts') toast('Attempt result', `${item.quizTitle}: ${item.score}/${item.graded ?? item.total} graded answers correct${item.ungradable ? `; ${item.ungradable} ungradable` : ''}.`, 'info');
  }

function bindSettingsControls() {
    els.toggleApiKeyButton.addEventListener('click', () => { els.apiKeyInput.type = els.apiKeyInput.type === 'password' ? 'text' : 'password'; });
    els.saveApiSettingsButton.addEventListener('click', saveApiSettings); els.testApiButton.addEventListener('click', testApiConnection);
    document.querySelectorAll('input[name="validationMode"]').forEach(input => input.addEventListener('change', () => { state.settings.validationMode = input.value; saveState(); }));
    els.numericTolerance.addEventListener('change', () => { state.settings.numericTolerance = Math.max(0, Number(els.numericTolerance.value) || .0001); saveState(); });
    [els.interfaceLanguage, els.interfaceLanguageQuick].forEach(select => select.addEventListener('change', () => setInterfaceLanguage(select.value)));
    els.defaultContentLanguage.addEventListener('change', () => {
      state.settings.contentLanguage = els.defaultContentLanguage.value;
      applyDefaultContentLanguage(false);
      saveState();
    });
    els.importWorkspaceButton.addEventListener('click', () => els.workspaceImportFile.click());
    els.workspaceImportFile.addEventListener('change', event => importWorkspace(event.target.files?.[0]));
    els.settingsExportWorkspaceButton.addEventListener('click', exportWorkspace);
    els.clearWorkspaceButton.addEventListener('click', () => confirmAction('Clear the entire workspace?', 'Saved summaries, exercises, templates, quizzes, attempts, and settings will be deleted from this browser.', () => {
      localStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(SESSION_KEY); state = createEmptyState(); applyStoredStateToUI(); renderAll(); toast('Workspace cleared', 'All local Study Forge data was removed.', 'success');
    }));
  }

function setInterfaceLanguage(language) {
  state.settings.uiLanguage = ['en', 'ro'].includes(language) ? language : 'en';
  els.interfaceLanguage.value = state.settings.uiLanguage;
  els.interfaceLanguageQuick.value = state.settings.uiLanguage;
  saveState();
  renderAll();
  scheduleInterfaceTranslation();
}

function applyDefaultContentLanguage(force = true) {
  const language = state.settings.contentLanguage || 'en';
  [els.summaryLanguage, els.aiExerciseLanguage, els.directLanguage].forEach(select => {
    if (select && (force || !select.dataset.userSelected)) select.value = language;
  });
}

function saveApiSettings() {
    state.settings.apiKey = els.apiKeyInput.value.trim(); state.settings.rememberApiKey = els.rememberApiKey.checked; state.settings.model = els.geminiModel.value;
    saveState(); renderApiStatus(); toast('Settings saved', state.settings.apiKey ? 'Gemini configuration was updated.' : 'The API key was removed.', 'success');
  }
async function testApiConnection() {
    state.settings.apiKey = els.apiKeyInput.value.trim(); state.settings.rememberApiKey = els.rememberApiKey.checked; state.settings.model = els.geminiModel.value;
    if (!state.settings.apiKey) return toast('API key required', 'Enter a Gemini API key first.', 'error');
    setButtonLoading(els.testApiButton, true, 'Testing…');
    try {
      const response = await callGemini('Reply with exactly: CONNECTION_OK');
      if (!response.includes('CONNECTION_OK')) throw new Error('The model responded, but the connection test result was unexpected.');
      saveState(); renderApiStatus(); toast('Gemini connected', 'The API key and selected model are working.', 'success');
    } catch (error) { renderApiStatus(false); toast('Connection failed', friendlyApiError(error), 'error'); }
    finally { setButtonLoading(els.testApiButton, false); }
  }

function escapeCssSelectorValue(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/[^a-zA-Z0-9_-]/g, character => `\\${character}`);
}

function safeStorageGet(storage, key) {
  try { return storage?.getItem(key) || ''; }
  catch (error) { console.warn('Browser storage is unavailable:', error); return ''; }
}

function applyStoredStateToUI() {
    document.body.dataset.theme = state.settings.theme || 'light';
    els.sourceTitle.value = state.source.title || '';
    els.sourceText.value = state.source.text || '';
    updateSourceCharCount();
    const key = state.settings.apiKey || safeStorageGet(globalThis.sessionStorage, SESSION_KEY);
    state.settings.apiKey = key;
    els.apiKeyInput.value = key;
    els.rememberApiKey.checked = Boolean(state.settings.rememberApiKey);
    els.geminiModel.value = state.settings.model || 'gemini-2.5-flash';
    const validationInput = document.querySelector(`input[name="validationMode"][value="${escapeCssSelectorValue(state.settings.validationMode || 'combined')}"]`);
    if (validationInput) validationInput.checked = true;
    els.numericTolerance.value = state.settings.numericTolerance ?? .0001;
    state.settings.uiLanguage = ['en', 'ro'].includes(state.settings.uiLanguage) ? state.settings.uiLanguage : 'en';
    state.settings.contentLanguage = ['en', 'ro'].includes(state.settings.contentLanguage) ? state.settings.contentLanguage : 'en';
    els.interfaceLanguage.value = state.settings.uiLanguage;
    els.interfaceLanguageQuick.value = state.settings.uiLanguage;
    els.defaultContentLanguage.value = state.settings.contentLanguage;
    applyDefaultContentLanguage(true);
    if (!els.templateText.value) { els.templateName.value = 'Asynchronous serial transmission'; els.templateText.value = DEFAULT_TEMPLATE; }
    updateAiExerciseControls();
    updateDirectExerciseControls();
    const hashView = location.hash.replace('#', '');
    if (hashView && document.getElementById(`view-${hashView}`)) navigateTo(hashView, false);
    scheduleInterfaceTranslation();
  }

function renderAll() {
    renderSourceStatus(); renderApiStatus(); renderStats(); renderRecentWork(); renderQuizBuilder(); renderLibrary(); updateStorageIndicators();
    if (state.currentSummary) renderSummaryOutput();
    if (state.currentExercise) {
      const tab = state.currentExercise.source === 'template' ? 'template' : state.currentExercise.source === 'direct' ? 'direct' : 'ai';
      const host = tab === 'template' ? els.templateExerciseHost : tab === 'direct' ? els.directExerciseHost : els.aiExerciseHost; renderExerciseCard(state.currentExercise, host);
    }
    scheduleInterfaceTranslation();
  }
function renderSourceStatus() {
    const hasSource = Boolean(state.source.text);
    const label = hasSource ? state.source.title || t('activeSource', state.settings.uiLanguage) : t('noActiveSource', state.settings.uiLanguage);
    [els.sourceStatusChip, els.summarySourceChip, els.exerciseSourceChip].forEach(chip => { chip.textContent = label; chip.classList.toggle('ready', hasSource); chip.title = label; });
  }
function renderApiStatus(forced) {
    const connected = forced ?? Boolean(getApiKey()); els.apiStatusButton.classList.toggle('connected', connected);
    els.apiStatusText.textContent = connected ? `Gemini · ${state.settings.model}` : t('geminiNotConnected', state.settings.uiLanguage);
    els.settingsApiBadge.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
    els.settingsApiBadge.textContent = connected ? t('configured', state.settings.uiLanguage) : t('notConnected', state.settings.uiLanguage);
  }
function renderStats() { els.summaryCount.textContent = state.summaries.length; els.exerciseCount.textContent = state.exercises.length; els.templateCount.textContent = state.templates.length; els.attemptCount.textContent = state.attempts.length; els.quizNavCount.textContent = state.quizDraft.length; }

function renderRecentWork() {
    const items = [...state.summaries.map(item => ({ ...item, _type: 'Summary', _date: item.createdAt })), ...state.exercises.map(item => ({ ...item, _type: 'Exercise', _date: item.createdAt })), ...state.templates.map(item => ({ ...item, _type: 'Template', _date: item.updatedAt }))].sort((a, b) => new Date(b._date) - new Date(a._date)).slice(0, 4);
    if (!items.length) { els.recentWork.className = 'empty-state compact'; els.recentWork.innerHTML = '<span>◇</span><strong>No saved work yet</strong><p>Your latest summaries, exercises, and templates will appear here.</p>'; return; }
    els.recentWork.className = 'quick-actions';
    els.recentWork.innerHTML = items.map(item => `<button class="quick-action" data-recent-type="${item._type.toLowerCase()}" data-recent-id="${escapeAttr(item.id)}"><span class="quick-icon lavender">${item._type === 'Summary' ? '≡' : item._type === 'Exercise' ? '✦' : '▤'}</span><span><strong>${escapeHtml(item.title || item.name || truncate(item.question, 50))}</strong><small>${escapeHtml(item._type)} · ${escapeHtml(formatDate(item._date))}</small></span><b>→</b></button>`).join('');
    els.recentWork.querySelectorAll('[data-recent-id]').forEach(button => button.addEventListener('click', () => {
      const mapping = { summary: 'summaries', exercise: 'exercises', template: 'templates' }; const type = mapping[button.dataset.recentType]; const item = state[type].find(entry => entry.id === button.dataset.recentId); if (item) openLibraryItem(item, type);
    }));
  }

function updateStorageIndicators() {
    const bytes = new Blob([safeStorageGet(globalThis.localStorage, STORAGE_KEY)]).size; const label = formatBytes(bytes);
    els.storageLabel.textContent = label; els.settingsStorageSize.textContent = label; els.storageBar.style.width = `${Math.min(100, (bytes / (5 * 1024 * 1024)) * 100)}%`;
  }

async function callGemini(prompt, jsonMode = false) {
    return requestGemini({
      prompt,
      jsonMode,
      apiKey: getApiKey(),
      model: state.settings.model || 'gemini-2.5-flash'
    });
  }

function getApiKey() {
    return (state.settings.apiKey || safeStorageGet(globalThis.sessionStorage, SESSION_KEY)).trim();
  }

function ensureSource() {
    if (state.source.text?.trim()) return true;
    toast('Study source required', 'Add a topic, text, TXT file, or PDF before generating content.', 'error');
    navigateTo('source');
    return false;
  }

function ensureApiKey() {
    if (getApiKey()) return true;
    toast('Gemini API key required', 'Add your key in Settings before using AI generation.', 'error');
    navigateTo('settings');
    return false;
  }

function renderSimpleMarkdown(markdown) {
    const source = String(markdown || '').replace(/\r\n?/g, '\n');
    const codeBlocks = [];
    const protectedSource = source.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, language, code) => {
      const index = codeBlocks.push(`<pre><code${language.trim() ? ` data-language="${escapeAttr(language.trim())}"` : ''}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`) - 1;
      return `\n@@CODE_BLOCK_${index}@@\n`;
    });

    const lines = protectedSource.split('\n');
    const output = [];
    let listType = null;
    let paragraph = [];

    const inline = value => escapeHtml(value)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

    const flushParagraph = () => {
      if (!paragraph.length) return;
      output.push(`<p>${inline(paragraph.join(' '))}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!listType) return;
      output.push(`</${listType}>`);
      listType = null;
    };

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) { flushParagraph(); closeList(); return; }
      const codeMatch = trimmed.match(/^@@CODE_BLOCK_(\d+)@@$/);
      if (codeMatch) { flushParagraph(); closeList(); output.push(codeBlocks[Number(codeMatch[1])]); return; }
      const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
      if (heading) { flushParagraph(); closeList(); const level = heading[1].length + 1; output.push(`<h${level}>${inline(heading[2])}</h${level}>`); return; }
      const quote = trimmed.match(/^>\s?(.+)$/);
      if (quote) { flushParagraph(); closeList(); output.push(`<blockquote>${inline(quote[1])}</blockquote>`); return; }
      const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
      const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const nextType = ordered ? 'ol' : 'ul';
        if (listType !== nextType) { closeList(); listType = nextType; output.push(`<${listType}>`); }
        output.push(`<li>${inline((unordered || ordered)[1])}</li>`);
        return;
      }
      if (/^---+$/.test(trimmed)) { flushParagraph(); closeList(); output.push('<hr>'); return; }
      closeList(); paragraph.push(trimmed);
    });
    flushParagraph(); closeList();
    return output.join('\n');
  }

function exportWorkspace() {
    const exported = clone(state);
    exported.settings.apiKey = '';
    downloadJson(`study-forge-workspace-${new Date().toISOString().slice(0, 10)}.json`, {
      app: 'Study Forge', version: 4, exportedAt: new Date().toISOString(), data: exported
    });
    toast('Workspace exported', 'Your study data was saved without the Gemini API key.', 'success');
  }

async function importWorkspace(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = parsed?.data || parsed;
      if (!incoming || typeof incoming !== 'object') throw new Error('This JSON file does not contain a Study Forge workspace.');
      const oldKey = getApiKey();
      const base = createEmptyState();
      state = {
        ...base,
        ...incoming,
        source: { ...base.source, ...(incoming.source || {}) },
        settings: { ...base.settings, ...(incoming.settings || {}), apiKey: oldKey },
        summaries: Array.isArray(incoming.summaries) ? incoming.summaries : [],
        exercises: Array.isArray(incoming.exercises) ? incoming.exercises.map(normalizeStoredExercise) : [],
        templates: Array.isArray(incoming.templates) ? incoming.templates : [],
        quizzes: Array.isArray(incoming.quizzes) ? incoming.quizzes : [],
        attempts: Array.isArray(incoming.attempts) ? incoming.attempts : [],
        quizDraft: []
      };
      if (state.currentExercise) state.currentExercise = normalizeStoredExercise(state.currentExercise);
      state.quizDraft = normalizeQuizProblems(incoming.quizDraft || [], state.templates, state.exercises);
      state.quizzes = state.quizzes.map(quiz => ({
        ...quiz,
        problems: normalizeQuizProblems(quiz.problems || quiz.exercises || [], state.templates, state.exercises)
      }));
      saveState(); applyStoredStateToUI(); renderAll();
      toast('Workspace imported', 'Saved materials and settings were restored. Your existing API key was preserved.', 'success');
    } catch (error) {
      toast('Import failed', error.message || 'The selected JSON file could not be imported.', 'error');
    } finally {
      els.workspaceImportFile.value = '';
    }
  }

function bindModalControls() {
    els.closeQuizModalButton.addEventListener('click', closeQuizModal);
    els.quizPreviousButton.addEventListener('click', () => {
      saveCurrentQuizResponse();
      if (quizSession?.index > 0) { quizSession.index -= 1; quizSession.awaitingNext = false; renderQuizPlayer(); }
    });
    els.quizSubmitButton.addEventListener('click', submitQuizAnswer);
    els.quizNextButton.addEventListener('click', () => {
      if (!quizSession) return;
      if (quizSession.completed) return closeQuizModal();
      if (quizSession.index >= quizSession.quiz.exercises.length - 1) finishQuiz();
      else { quizSession.index += 1; quizSession.awaitingNext = false; renderQuizPlayer(); }
    });
    els.confirmCancelButton.addEventListener('click', closeConfirmModal);
    els.confirmAcceptButton.addEventListener('click', async () => {
      const action = pendingConfirmAction;
      closeConfirmModal();
      if (action) await action();
    });
    els.confirmModal.addEventListener('click', event => { if (event.target === els.confirmModal) closeConfirmModal(); });
    els.quizModal.addEventListener('click', event => { if (event.target === els.quizModal) closeQuizModal(); });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!els.quizModal.classList.contains('hidden')) closeQuizModal();
      if (!els.confirmModal.classList.contains('hidden')) closeConfirmModal();
    });
  }

function confirmAction(title, message, action) {
    pendingConfirmAction = action;
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmModal.classList.remove('hidden');
    els.confirmAcceptButton.focus();
  }

function closeConfirmModal() {
    pendingConfirmAction = null;
    els.confirmModal.classList.add('hidden');
  }

function setButtonLoading(button, loading, label = 'Working…') {
    if (!button) return;
    if (loading) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span>${escapeHtml(label)}`;
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }

function toast(title, message, type = 'info') {
    const element = document.createElement('div');
    element.className = `toast ${type}`;
    element.setAttribute('role', type === 'error' ? 'alert' : 'status');
    element.innerHTML = `<span class="toast-mark">${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div><button type="button" aria-label="Dismiss notification">×</button>`;
    els.toastRegion.appendChild(element);
    const remove = () => { element.classList.add('leaving'); setTimeout(() => element.remove(), 180); };
    element.querySelector('button').addEventListener('click', remove);
    setTimeout(remove, type === 'error' ? 6500 : 4300);
  }

async function copyText(text) {
    if (!text) return toast('Nothing to copy', 'Generate or select some content first.', 'error');
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement('textarea');
        area.value = text; area.style.position = 'fixed'; area.style.opacity = '0';
        document.body.appendChild(area); area.select();
        if (!document.execCommand('copy')) throw new Error('Copy command was not accepted.');
        area.remove();
      }
      toast('Copied', 'The content is now on your clipboard.', 'success');
    } catch (error) { toast('Copy failed', 'Select the content and copy it manually.', 'error'); }
  }

