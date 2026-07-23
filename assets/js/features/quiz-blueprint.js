import { clone, uid } from '../core/utils.js';

export function createQuizProblem(exercises = []) {
  const candidates = deduplicateExercises(exercises);
  return {
    id: uid(),
    title: '',
    candidateIds: candidates.map(item => item.id),
    candidateSnapshots: Object.fromEntries(candidates.map(item => [item.id, clone(item)]))
  };
}

export function normalizeQuizProblems(rawProblems = [], exerciseLibrary = []) {
  const libraryById = new Map(exerciseLibrary.map(item => [item.id, item]));
  if (!Array.isArray(rawProblems)) return [];

  return rawProblems.map(item => {
    if (isExercise(item)) {
      return createQuizProblem([item]);
    }

    const ids = Array.isArray(item?.candidateIds)
      ? item.candidateIds.filter(Boolean)
      : Array.isArray(item?.candidates)
        ? item.candidates.map(candidate => candidate?.id).filter(Boolean)
        : [];
    const snapshots = item?.candidateSnapshots && typeof item.candidateSnapshots === 'object'
      ? clone(item.candidateSnapshots)
      : {};

    for (const candidate of item?.candidates || []) {
      if (candidate?.id) snapshots[candidate.id] = clone(candidate);
    }
    ids.forEach(id => {
      if (!snapshots[id] && libraryById.has(id)) snapshots[id] = clone(libraryById.get(id));
    });

    return {
      id: item?.id || uid(),
      title: String(item?.title || ''),
      candidateIds: [...new Set(ids)],
      candidateSnapshots: snapshots
    };
  });
}

export function setProblemCandidates(problem, candidateIds, exerciseLibrary = []) {
  const libraryById = new Map(exerciseLibrary.map(item => [item.id, item]));
  const ids = [...new Set(candidateIds.filter(Boolean))];
  const snapshots = { ...(problem.candidateSnapshots || {}) };
  ids.forEach(id => {
    if (libraryById.has(id)) snapshots[id] = clone(libraryById.get(id));
  });
  Object.keys(snapshots).forEach(id => {
    if (!ids.includes(id)) delete snapshots[id];
  });
  return { ...problem, candidateIds: ids, candidateSnapshots: snapshots };
}

export function getProblemCandidates(problem, exerciseLibrary = []) {
  const libraryById = new Map(exerciseLibrary.map(item => [item.id, item]));
  return (problem.candidateIds || []).map(id =>
    libraryById.get(id) || problem.candidateSnapshots?.[id]
  ).filter(Boolean).map(clone);
}

export function resolveQuizProblems(problems, exerciseLibrary = [], random = Math.random) {
  return problems.map((problem, index) => {
    const candidates = getProblemCandidates(problem, exerciseLibrary);
    if (!candidates.length) {
      throw new Error(`Problem ${index + 1} does not have any available exercises.`);
    }
    const selected = candidates[Math.floor(random() * candidates.length)];
    return {
      ...clone(selected),
      quizProblemId: problem.id,
      quizProblemTitle: problem.title || `Problem ${index + 1}`,
      candidateCount: candidates.length
    };
  });
}

export function validateQuizProblems(problems, exerciseLibrary = []) {
  const issues = [];
  if (!problems.length) issues.push('Add at least one problem.');
  problems.forEach((problem, index) => {
    const candidates = getProblemCandidates(problem, exerciseLibrary);
    if (!candidates.length) issues.push(`Problem ${index + 1} needs at least one candidate exercise.`);
  });
  return issues;
}

function deduplicateExercises(exercises) {
  const byId = new Map();
  exercises.filter(isExercise).forEach(item => byId.set(item.id, item));
  return [...byId.values()];
}

function isExercise(item) {
  return Boolean(item && typeof item === 'object' && item.id && item.question && 'answer' in item);
}
