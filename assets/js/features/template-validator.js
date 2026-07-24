import {
  createSeededRandom,
  extractIdentifiers,
  extractPlaceholders,
  getDefinitionPossibleValues,
  instantiateParsedTemplate,
  parseTemplate,
  resolveAnswerDependencies
} from './template-engine.js';

export function validateTemplate(templateText, options = {}) {
  const requestedRuns = clampRuns(options.runs ?? 25);
  const issues = [];
  let parsed;

  try {
    parsed = parseTemplate(templateText);
  } catch (error) {
    return {
      valid: false,
      parsed: null,
      issues: [issue('error', 'syntax', error.message)],
      trials: emptyTrialSummary(requestedRuns),
      sampleInstances: []
    };
  }

  if (parsed.semantic) runSemanticStaticChecks(parsed, issues);
  else runStaticChecks(parsed, issues);
  const trialResult = runTrialChecks(parsed, requestedRuns, issues);
  runSeedChecks(parsed, issues);

  return {
    valid: !issues.some(item => item.severity === 'error'),
    parsed,
    issues: deduplicateIssues(issues),
    trials: trialResult.summary,
    sampleInstances: trialResult.samples
  };
}


function runSemanticStaticChecks(parsed, issues) {
  const definitionNames = new Set(parsed.definitions.map(item => item.name));
  const assignmentNames = new Set(parsed.assignments.map(item => item.name));
  const mappedOutputNames = new Set(parsed.mappings.flatMap(item => item.outputNames));
  const collectionNames = new Set(parsed.collections.map(item => item.name));
  const collectionFieldNames = new Set(parsed.collections.flatMap(item => item.fields?.map(field => field.name) || []));
  const localNames = new Set(['INDEX', 'INDEX0', 'ROW_INDEX', 'ROW_INDEX0', 'COLUMN_INDEX', 'COLUMN_INDEX0', 'VALUES', 'VALUE']);
  const knownVariables = new Set([...definitionNames, ...assignmentNames, ...mappedOutputNames, ...collectionNames, ...collectionFieldNames, ...localNames]);
  const semanticText = [
    parsed.sections.question,
    parsed.semanticAnswer?.REFERENCE,
    parsed.semanticAnswer?.ESSENTIAL_CONCEPTS,
    parsed.semanticAnswer?.SUPPORTING_CONCEPTS,
    parsed.semanticAnswer?.ACCEPTED_EXPRESSIONS,
    parsed.semanticAnswer?.KNOWN_INCORRECT_CLAIMS,
    parsed.feedback?.HINT,
    parsed.feedback?.SOLUTION,
    parsed.feedback?.EXPLANATION
  ].filter(Boolean).join('\n');

  parsed.unknownSections.forEach(name => issues.push(issue(
    'warning',
    'unknown-section',
    `Section ## ${name} is not part of the supported template format and will be ignored.`
  )));

  runCollectionStaticChecks(parsed, issues, new Set([...definitionNames, ...mappedOutputNames]));

  extractPlaceholders(semanticText).forEach(name => {
    if (!knownVariables.has(name)) {
      issues.push(issue('error', 'undefined-placeholder', `Placeholder {${name}} is not defined and is not produced by a formula.`));
    }
  });

  parsed.definitions.forEach(definition => {
    if (definition.rule.type !== 'range') return;
    const span = definition.rule.max - definition.rule.min;
    const steps = span / definition.rule.step;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) issues.push(issue(
      'warning',
      'uneven-step-range',
      `${definition.name} uses step ${definition.rule.step}, which does not land exactly on the maximum ${definition.rule.max}.`
    ));
  });

  parsed.mappings.forEach(mapping => {
    const definition = parsed.definitions.find(item => item.name === mapping.sourceName);
    if (!definition) {
      issues.push(issue('error', 'mapping-without-definition', `Mapping ${mapping.outputName} uses missing source definition ${mapping.sourceName}.`));
      return;
    }
    const possibleValues = getDefinitionPossibleValues(definition);
    if (!possibleValues) return;
    const possibleKeys = possibleValues.map(value => String(value).trim().toLowerCase());
    const missing = possibleKeys.filter(key => !(key in mapping.values));
    if (missing.length) issues.push(issue(
      'error',
      'incomplete-mapping',
      `${mapping.outputName} has no mapped result for ${mapping.sourceName}: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}.`
    ));
  });

  const available = new Set([...definitionNames, ...collectionNames, 'PI', 'E']);
  parsed.mappings.forEach(mapping => {
    if (definitionNames.has(mapping.sourceName)) mapping.outputNames.forEach(name => available.add(name));
  });
  parsed.assignments.forEach(assignment => {
    extractIdentifiers(assignment.expression).forEach(name => {
      if (!available.has(name)) issues.push(issue(
        'error',
        assignmentNames.has(name) ? 'forward-reference' : 'unknown-formula-variable',
        assignmentNames.has(name)
          ? `${assignment.name} uses ${name} before ${name} is calculated.`
          : `${assignment.name} uses unknown formula variable ${name}.`
      ));
    });
    available.add(assignment.name);
  });
  parsed.constraints.forEach(constraint => {
    extractIdentifiers(constraint.expression).forEach(name => {
      if (!available.has(name)) issues.push(issue(
        'error',
        'unknown-constraint-variable',
        `Constraint “${constraint.expression}” uses unknown variable ${name}.`
      ));
    });
  });

  const strictness = String(parsed.semanticAnswer?.STRICTNESS || 'moderate').trim().toLowerCase();
  if (!['lenient', 'moderate', 'strict', 'exacting'].includes(strictness)) issues.push(issue(
    'error',
    'invalid-semantic-strictness',
    'STRICTNESS must be lenient, moderate, strict, or exacting.'
  ));
}

function runStaticChecks(parsed, issues) {
  const definitionNames = new Set(parsed.definitions.map(item => item.name));
  const assignmentNames = new Set(parsed.assignments.map(item => item.name));
  const mappedOutputNames = new Set(parsed.mappings.flatMap(item => item.outputNames));
  const collectionNames = new Set(parsed.collections.map(item => item.name));
  const collectionFieldNames = new Set(parsed.collections.flatMap(item => item.fields?.map(field => field.name) || []));
  const localNames = new Set(['INDEX', 'INDEX0', 'ROW_INDEX', 'ROW_INDEX0', 'COLUMN_INDEX', 'COLUMN_INDEX0', 'VALUES', 'VALUE']);
  const knownQuestionVariables = new Set([
    ...definitionNames,
    ...mappedOutputNames,
    ...assignmentNames,
    ...collectionNames,
    ...collectionFieldNames,
    ...localNames
  ]);
  const placeholders = extractPlaceholders(parsed.sections.question);
  const placeholderSet = new Set(placeholders);
  const visibleCollections = new Set(parsed.collections
    .map(item => item.name)
    .filter(name => parsed.sections.question.includes(`{{matrix ${name}}`)
      || parsed.sections.question.includes(`{{#each ${name}}`)
      || placeholderSet.has(name)));
  const answerDependencies = resolveAnswerDependencies(parsed);
  const requiredDefinitions = parsed.definitions
    .map(item => item.name)
    .filter(name => answerDependencies.has(name));
  const requiredCollections = parsed.collections
    .map(item => item.name)
    .filter(name => answerDependencies.has(name));

  parsed.unknownSections.forEach(name => issues.push(issue(
    'warning',
    'unknown-section',
    `Section ## ${name} is not part of the supported template format and will be ignored.`
  )));

  runCollectionStaticChecks(parsed, issues, new Set([...definitionNames, ...mappedOutputNames]));

  placeholders.forEach(name => {
    if (!knownQuestionVariables.has(name)) {
      issues.push(issue('error', 'undefined-placeholder', `Placeholder {${name}} is not defined and is not produced by a formula.`));
      return;
    }
    if (name === parsed.answerVariable) {
      issues.push(issue('error', 'answer-exposed', `{${name}} exposes the expected answer inside the exercise question.`));
    } else if (assignmentNames.has(name) || mappedOutputNames.has(name)) {
      issues.push(issue('warning', 'derived-value-exposed', `{${name}} is a calculated value. Showing it may remove a required solution step.`));
    }
  });

  requiredDefinitions.forEach(name => {
    const shownThroughCollection = parsed.collections.some(collection =>
      visibleCollections.has(collection.name)
      && [collection.countExpression, collection.rowsExpression, collection.columnsExpression]
        .filter(Boolean)
        .some(expression => extractIdentifiers(expression).includes(name))
    );
    if (!placeholderSet.has(name) && !shownThroughCollection) issues.push(issue(
      'error',
      'hidden-required-input',
      `${name} is required to calculate the answer but is not shown in the exercise question.`
    ));
  });

  requiredCollections.forEach(name => {
    if (!visibleCollections.has(name)) issues.push(issue(
      'error',
      'hidden-required-collection',
      `${name} is required to calculate the answer but is not rendered in the exercise question.`
    ));
  });

  placeholders.forEach(name => {
    if (definitionNames.has(name) && !answerDependencies.has(name)) {
      issues.push(issue('warning', 'unused-question-value', `${name} appears in the question but does not influence the final answer.`));
    }
  });

  parsed.definitions.forEach(definition => {
    const usedInQuestion = placeholderSet.has(definition.name);
    const usedInAnswer = answerDependencies.has(definition.name);
    const usedByMapping = parsed.mappings.some(mapping => mapping.sourceName === definition.name);
    if (!usedInQuestion && !usedInAnswer && !usedByMapping) {
      issues.push(issue('warning', 'unused-definition', `${definition.name} is defined but never used.`));
    }

    if (definition.rule.type === 'range') {
      const span = definition.rule.max - definition.rule.min;
      const steps = span / definition.rule.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        issues.push(issue(
          'warning',
          'uneven-step-range',
          `${definition.name} uses step ${definition.rule.step}, which does not land exactly on the maximum ${definition.rule.max}. The maximum cannot be generated.`
        ));
      }
      if (steps > 1_000_000) {
        issues.push(issue(
          'warning',
          'very-large-range',
          `${definition.name} contains more than one million possible stepped values. Consider a larger step.`
        ));
      }
    }
  });

  parsed.collections.forEach(collection => {
    const usedInQuestion = visibleCollections.has(collection.name);
    const usedInAnswer = answerDependencies.has(collection.name);
    const usedElsewhere = parsed.assignments.some(assignment => extractIdentifiers(assignment.expression).includes(collection.name))
      || parsed.constraints.some(constraint => extractIdentifiers(constraint.expression).includes(collection.name))
      || (parsed.repeatedAnswerConfigs || []).some(config => config.source === collection.name);
    if (!usedInQuestion && !usedInAnswer && !usedElsewhere) issues.push(issue(
      'warning',
      'unused-collection',
      `${collection.name} is generated but never rendered or used.`
    ));
  });

  parsed.mappings.forEach(mapping => {
    const definition = parsed.definitions.find(item => item.name === mapping.sourceName);
    if (!definition) {
      issues.push(issue('error', 'mapping-without-definition', `Mapping ${mapping.outputName} uses missing source definition ${mapping.sourceName}.`));
      return;
    }

    const possibleValues = getDefinitionPossibleValues(definition);
    if (possibleValues) {
      const possibleKeys = possibleValues.map(value => String(value).trim().toLowerCase());
      const missing = possibleKeys.filter(key => !(key in mapping.values));
      if (missing.length) issues.push(issue(
        'error',
        'incomplete-mapping',
        `${mapping.outputName} has no mapped result for ${mapping.sourceName}: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}.`
      ));
      const extra = Object.keys(mapping.values).filter(key => !possibleKeys.includes(key));
      if (extra.length) issues.push(issue(
        'warning',
        'unused-mapping-entry',
        `${mapping.outputName} contains mapping entries that ${mapping.sourceName} cannot generate: ${extra.join(', ')}.`
      ));
    } else {
      issues.push(issue(
        'warning',
        'range-mapping',
        `${mapping.outputName} maps a large numeric range. Any generated value without a matching entry will fail.`
      ));
    }
  });

  const available = new Set([...definitionNames, ...collectionNames, ...Object.keys({ PI: true, E: true })]);
  parsed.mappings.forEach(mapping => {
    if (definitionNames.has(mapping.sourceName)) mapping.outputNames.forEach(name => available.add(name));
  });

  parsed.assignments.forEach(assignment => {
    extractIdentifiers(assignment.expression).forEach(name => {
      if (!available.has(name)) {
        issues.push(issue(
          'error',
          assignmentNames.has(name) ? 'forward-reference' : 'unknown-formula-variable',
          assignmentNames.has(name)
            ? `${assignment.name} uses ${name} before ${name} is calculated.`
            : `${assignment.name} uses unknown formula variable ${name}.`
        ));
      }
    });
    if (definitionNames.has(assignment.name)) issues.push(issue(
      'warning',
      'definition-overwritten',
      `${assignment.name} is both an input definition and a formula assignment; the generated input will be overwritten.`
    ));
    available.add(assignment.name);
  });

  parsed.constraints.forEach(constraint => {
    extractIdentifiers(constraint.expression).forEach(name => {
      if (!available.has(name)) issues.push(issue(
        'error',
        'unknown-constraint-variable',
        `Constraint “${constraint.expression}” uses unknown variable ${name}.`
      ));
    });
  });

  if (!parsed.answerVariable && !(parsed.repeatedAnswerConfigs || []).length) {
    issues.push(issue('error', 'missing-answer', 'No final answer variable or repeated answer group is configured.'));
  } else if (parsed.answerVariable && !available.has(parsed.answerVariable)) {
    issues.push(issue('error', 'unknown-answer-variable', `Answer VALUE refers to unknown variable ${parsed.answerVariable}.`));
  }

  (parsed.repeatedAnswerConfigs || []).forEach(config => {
    if (!collectionNames.has(config.source)) issues.push(issue(
      'error', 'unknown-repeated-answer-source',
      `Repeated answer ${config.groupName} uses unknown collection ${config.source}.`
    ));
    const localAllowed = new Set(['INDEX', 'INDEX0', 'ROW_INDEX', 'ROW_INDEX0', 'COLUMN_INDEX', 'COLUMN_INDEX0', 'VALUES', 'VALUE']);
    const collection = parsed.collections.find(item => item.name === config.source);
    (collection?.fields || []).forEach(field => localAllowed.add(field.name));
    extractIdentifiers(config.valueExpression).forEach(name => {
      if (!available.has(name) && !localAllowed.has(name)) issues.push(issue(
        'error', 'unknown-repeated-answer-variable',
        `Repeated answer ${config.groupName} uses unknown variable ${name}.`
      ));
    });
  });

  parsed.assignments.forEach(assignment => {
    if (!answerDependencies.has(assignment.name)) issues.push(issue(
      'warning',
      'unused-assignment',
      `${assignment.name} is calculated but does not influence the final answer.`
    ));
  });

  parsed.mappings.forEach(mapping => {
    if (!mapping.outputNames.some(name => answerDependencies.has(name))) issues.push(issue(
      'warning',
      'unused-mapping',
      `${mapping.outputName} is mapped but does not influence the final answer.`
    ));
  });

  if (parsed.answerVariable && !parsed.assignments.some(item => item.name === 'ANSWER') && parsed.answerVariable !== 'ANSWER') {
    issues.push(issue(
      'warning',
      'implicit-answer',
      `${parsed.answerVariable} is configured as the final answer. An explicit ANSWER assignment can make the template easier to read.`
    ));
  }

  if (!requiredDefinitions.length && ![...collectionNames].some(name => answerDependencies.has(name))) issues.push(issue(
    'warning',
    'constant-answer',
    'The final answer does not depend on any randomized or fixed input definition.'
  ));

  if (parsed.answerConfig && !['absolute', 'percentage'].includes(parsed.answerConfig.toleranceType)) issues.push(issue(
    'error',
    'invalid-tolerance-type',
    'TOLERANCE_TYPE must be absolute or percentage.'
  ));

  if (parsed.answerConfig && !['exact', 'numeric', 'symbolic', 'semantic', 'combined'].includes(parsed.answerConfig.equivalence)) issues.push(issue(
    'error',
    'invalid-equivalence',
    'EQUIVALENCE must be exact, numeric, symbolic, semantic, or combined.'
  ));
}

function runCollectionStaticChecks(parsed, issues, initialAvailable) {
  const available = new Set(initialAvailable);
  const isGeneratedSizeRule = expression => {
    const source = String(expression || '').trim();
    return /^-?\d+(?:\.\d+)?(?:\s*\.\.\s*-?\d+(?:\.\d+)?(?:\s*;\s*step\s*=\s*\d+(?:\.\d+)?)?)?$/.test(source)
      || (source.includes(',') && !/[A-Za-z_]/.test(source));
  };

  for (const collection of parsed.collections || []) {
    const sizeExpressions = [
      ['COUNT', collection.countExpression],
      ['ROWS', collection.rowsExpression],
      ['COLUMNS', collection.columnsExpression]
    ].filter(([, expression]) => expression);
    for (const [label, expression] of sizeExpressions) {
      if (isGeneratedSizeRule(expression)) continue;
      extractIdentifiers(expression).forEach(name => {
        if (!available.has(name)) issues.push(issue(
          'error',
          'unknown-collection-size-variable',
          `${collection.name} ${label} uses ${name}, which is not available before that collection is generated.`
        ));
      });
    }
    available.add(collection.name);
  }

  (parsed.repeatedAnswerConfigs || []).forEach(config => {
    const source = parsed.collections.find(collection => collection.name === config.source);
    if (config.mode === 'columns' && source && source.type !== 'matrix') issues.push(issue(
      'error',
      'invalid-repeated-answer-mode',
      `${config.groupName} uses MODE: columns, but ${config.source} is not a matrix.`
    ));
  });
}

function runTrialChecks(parsed, runs, issues) {
  const samples = [];
  const answers = [];
  const uniqueQuestions = new Set();
  const attemptCounts = [];
  let successes = 0;
  let failures = 0;
  const failureMessages = new Map();

  for (let index = 0; index < runs; index += 1) {
    try {
      const instance = instantiateParsedTemplate(parsed, { seed: index + 1 });
      successes += 1;
      answers.push(instance.answer);
      attemptCounts.push(instance.attempt);
      uniqueQuestions.add(instance.question);
      if (samples.length < 3) samples.push(instance);

      if (typeof instance.answer === 'number' && Number.isFinite(instance.answer)) {
        if (instance.answer < 0) issues.push(issue('warning', 'negative-answer', 'At least one randomized test produced a negative answer.'));
        if (Math.abs(instance.answer) > 1e12 || String(instance.answer).length > 20) issues.push(issue(
          'warning',
          'large-answer',
          'At least one randomized test produced a very large or lengthy answer. Consider rounding or narrower ranges.'
        ));
      }
    } catch (error) {
      failures += 1;
      const message = String(error.message || error);
      failureMessages.set(message, (failureMessages.get(message) || 0) + 1);
    }
  }

  failureMessages.forEach((count, message) => {
    const constraintFailure = /No valid value combination/.test(message);
    issues.push(issue(
      'error',
      constraintFailure ? 'constraints-unsatisfied' : /division|zero|non-finite|infinity/i.test(message) ? 'runtime-non-finite' : 'runtime-failure',
      `${count} of ${runs} randomized tests failed: ${message}`
    ));
  });

  if (successes && uniqueQuestions.size === 1 && (parsed.definitions.some(item => item.rule.type !== 'fixed') || parsed.collections.length)) {
    issues.push(issue(
      'warning',
      'no-visible-variation',
      'The template contains randomized definitions, but all tested questions were identical. Check whether randomized values appear in the question.'
    ));
  }

  const averageAttempts = attemptCounts.length
    ? attemptCounts.reduce((total, value) => total + value, 0) / attemptCounts.length
    : null;
  const maximumAttempts = attemptCounts.length ? Math.max(...attemptCounts) : null;
  if (averageAttempts !== null && averageAttempts > 20) issues.push(issue(
    'warning',
    'restrictive-constraints',
    `Constraints required an average of ${averageAttempts.toFixed(1)} generation attempts. Consider widening the valid value space.`
  ));

  const numericAnswers = answers.filter(value => typeof value === 'number' && Number.isFinite(value));
  return {
    summary: {
      requested: runs,
      successes,
      failures,
      uniqueQuestions: uniqueQuestions.size,
      minimumAnswer: numericAnswers.length ? Math.min(...numericAnswers) : null,
      maximumAnswer: numericAnswers.length ? Math.max(...numericAnswers) : null,
      averageAttempts,
      maximumAttempts
    },
    samples
  };
}

function runSeedChecks(parsed, issues) {
  const seed = parsed.seedSpec.type === 'fixed' ? parsed.seedSpec.value : 1729;
  try {
    const first = instantiateParsedTemplate(parsed, { seed, random: createSeededRandom(seed) });
    const second = instantiateParsedTemplate(parsed, { seed, random: createSeededRandom(seed) });
    if (first.question !== second.question || first.answer !== second.answer || first.attempt !== second.attempt) {
      issues.push(issue('error', 'seed-not-reproducible', 'The same seed did not reproduce the same generated exercise.'));
    }
  } catch (error) {
    issues.push(issue('error', 'seed-test-failed', `Seed reproducibility could not be tested: ${error.message}`));
  }
}

function issue(severity, code, message) {
  return { severity, code, message };
}

function deduplicateIssues(issues) {
  const seen = new Set();
  return issues.filter(item => {
    const key = `${item.severity}:${item.code}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function emptyTrialSummary(requested) {
  return {
    requested,
    successes: 0,
    failures: 0,
    uniqueQuestions: 0,
    minimumAnswer: null,
    maximumAnswer: null,
    averageAttempts: null,
    maximumAttempts: null
  };
}

function clampRuns(value) {
  const number = Number(value) || 25;
  return Math.min(100, Math.max(1, Math.round(number)));
}
