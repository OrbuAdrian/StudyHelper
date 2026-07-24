import { clone, uid } from '../core/utils.js';

export function createQuizProblem(templates = []) {
  const candidates = deduplicateTemplates(templates);
  return {
    id: uid(),
    title: '',
    candidateTemplateIds: candidates.map(item => item.id),
    templateSnapshots: Object.fromEntries(candidates.map(item => [item.id, clone(item)])),
    legacyExerciseIds: [],
    legacyExerciseSnapshots: {}
  };
}

export function normalizeQuizProblems(rawProblems = [], templateLibrary = [], exerciseLibrary = []) {
  const templatesById = new Map(templateLibrary.map(item => [item.id, item]));
  const exercisesById = new Map(exerciseLibrary.map(item => [item.id, item]));
  if (!Array.isArray(rawProblems)) return [];

  return rawProblems.map(item => {
    if (isTemplate(item)) return createQuizProblem([item]);
    if (isExercise(item)) return createLegacyProblem([item]);

    const templateIds = new Set([
      ...(Array.isArray(item?.candidateTemplateIds) ? item.candidateTemplateIds : []),
      ...(Array.isArray(item?.templateIds) ? item.templateIds : [])
    ].filter(Boolean));
    const legacyExerciseIds = new Set(Array.isArray(item?.legacyExerciseIds) ? item.legacyExerciseIds.filter(Boolean) : []);
    const templateSnapshots = clone(item?.templateSnapshots || {});
    const legacyExerciseSnapshots = clone(item?.legacyExerciseSnapshots || {});

    for (const candidate of item?.templates || []) {
      if (isTemplate(candidate)) {
        templateIds.add(candidate.id);
        templateSnapshots[candidate.id] = clone(candidate);
      }
    }

    // Migrate the previous exercise-candidate model. If an id now belongs to a
    // template, use it as a template; otherwise preserve the exercise snapshot.
    for (const id of Array.isArray(item?.candidateIds) ? item.candidateIds : []) {
      if (templatesById.has(id) || isTemplate(item?.candidateSnapshots?.[id])) {
        templateIds.add(id);
        if (item?.candidateSnapshots?.[id]) templateSnapshots[id] = clone(item.candidateSnapshots[id]);
      } else {
        legacyExerciseIds.add(id);
        if (item?.candidateSnapshots?.[id]) legacyExerciseSnapshots[id] = clone(item.candidateSnapshots[id]);
      }
    }

    for (const candidate of item?.candidates || []) {
      if (isTemplate(candidate)) {
        templateIds.add(candidate.id);
        templateSnapshots[candidate.id] = clone(candidate);
      } else if (isExercise(candidate)) {
        legacyExerciseIds.add(candidate.id);
        legacyExerciseSnapshots[candidate.id] = clone(candidate);
      }
    }

    for (const id of templateIds) {
      if (!templateSnapshots[id] && templatesById.has(id)) templateSnapshots[id] = clone(templatesById.get(id));
    }
    for (const id of legacyExerciseIds) {
      if (!legacyExerciseSnapshots[id] && exercisesById.has(id)) legacyExerciseSnapshots[id] = clone(exercisesById.get(id));
    }

    return {
      id: item?.id || uid(),
      title: String(item?.title || ''),
      candidateTemplateIds: [...templateIds],
      templateSnapshots,
      legacyExerciseIds: [...legacyExerciseIds],
      legacyExerciseSnapshots
    };
  });
}

export function setProblemCandidates(problem, candidateTemplateIds, templateLibrary = []) {
  const templatesById = new Map(templateLibrary.map(item => [item.id, item]));
  const ids = [...new Set((candidateTemplateIds || []).filter(Boolean))];
  const snapshots = { ...(problem.templateSnapshots || {}) };
  ids.forEach(id => {
    if (templatesById.has(id)) snapshots[id] = clone(templatesById.get(id));
  });
  Object.keys(snapshots).forEach(id => {
    if (!ids.includes(id)) delete snapshots[id];
  });
  return {
    ...problem,
    candidateTemplateIds: ids,
    templateSnapshots: snapshots
  };
}

export function getProblemCandidates(problem, templateLibrary = [], exerciseLibrary = []) {
  const templatesById = new Map(templateLibrary.map(item => [item.id, item]));
  const exercisesById = new Map(exerciseLibrary.map(item => [item.id, item]));
  const templates = (problem.candidateTemplateIds || []).map(id =>
    templatesById.get(id) || problem.templateSnapshots?.[id]
  ).filter(isTemplate).map(template => ({ kind: 'template', id: template.id, value: clone(template) }));
  const legacy = (problem.legacyExerciseIds || []).map(id =>
    exercisesById.get(id) || problem.legacyExerciseSnapshots?.[id]
  ).filter(isExercise).map(exercise => ({ kind: 'exercise', id: exercise.id, value: clone(exercise) }));
  return [...templates, ...legacy];
}

export function resolveQuizProblems(problems, templateLibrary = [], options = {}) {
  const normalizedOptions = typeof options === 'function' ? { random: options } : options;
  const random = normalizedOptions.random || Math.random;
  const exerciseLibrary = normalizedOptions.exerciseLibrary || [];
  const instantiate = normalizedOptions.instantiateTemplate;
  const buildExercise = normalizedOptions.buildExercise;

  return problems.map((problem, index) => {
    const candidates = getProblemCandidates(problem, templateLibrary, exerciseLibrary);
    if (!candidates.length) throw new Error(`Problem ${index + 1} does not have any available templates.`);
    const selected = candidates[Math.floor(random() * candidates.length)];
    let exercise;
    if (selected.kind === 'template') {
      if (typeof instantiate !== 'function' || typeof buildExercise !== 'function') {
        exercise = clone(selected.value);
      } else {
        const instance = instantiate(selected.value.text);
        exercise = buildExercise(instance, selected.value);
      }
    } else {
      exercise = clone(selected.value);
    }
    return {
      ...exercise,
      quizProblemId: problem.id,
      quizProblemTitle: problem.title || `Problem ${index + 1}`,
      candidateCount: candidates.length,
      sourceTemplateId: selected.kind === 'template' ? selected.value.id : exercise.sourceTemplateId,
      sourceTemplateName: selected.kind === 'template' ? selected.value.name : exercise.sourceTemplateName
    };
  });
}

export function validateQuizProblems(problems, templateLibrary = [], exerciseLibrary = []) {
  const issues = [];
  if (!problems.length) issues.push('Add at least one problem.');
  problems.forEach((problem, index) => {
    const candidates = getProblemCandidates(problem, templateLibrary, exerciseLibrary);
    if (!candidates.length) issues.push(`Problem ${index + 1} needs at least one candidate template.`);
  });
  return issues;
}

function createLegacyProblem(exercises) {
  const candidates = deduplicateExercises(exercises);
  return {
    id: uid(),
    title: '',
    candidateTemplateIds: [],
    templateSnapshots: {},
    legacyExerciseIds: candidates.map(item => item.id),
    legacyExerciseSnapshots: Object.fromEntries(candidates.map(item => [item.id, clone(item)]))
  };
}

function deduplicateTemplates(templates) {
  const byId = new Map();
  templates.filter(isTemplate).forEach(item => byId.set(item.id, item));
  return [...byId.values()];
}

function deduplicateExercises(exercises) {
  const byId = new Map();
  exercises.filter(isExercise).forEach(item => byId.set(item.id, item));
  return [...byId.values()];
}

function isTemplate(item) {
  return Boolean(item && typeof item === 'object' && item.id && typeof item.text === 'string');
}

function isExercise(item) {
  return Boolean(item && typeof item === 'object' && item.id && item.question && 'answer' in item);
}
