import {
  decimalCount,
  formatAnswer
} from '../core/utils.js';

const ALLOWED_FUNCTIONS = [
  'abs', 'round', 'floor', 'ceil', 'min', 'max', 'sqrt', 'pow'
];
const CONSTANTS = { PI: Math.PI, E: Math.E };
const KNOWN_SECTIONS = new Set([
  'metadata', 'definitions', 'mappings', 'formula', 'constraints',
  'answer', 'answers', 'choices', 'feedback'
]);

export function parseTemplate(templateText) {
  const sections = splitTemplateSections(templateText);
  const metadata = parseKeyValueSection(sections.metadata);
  const definitions = parseDefinitions(sections.definitions);
  const explicitMappings = parseMappingsSection(sections.mappings);
  const formula = parseFormulaSection(sections.formula);
  const mappings = mergeMappings(explicitMappings, formula.mappings);
  const constraints = parseConstraints(sections.constraints);
  const answerConfig = parseAnswerSection(sections.answer, formula.assignments);
  const answerConfigs = parseAnswersSection(sections.answers, answerConfig);
  const feedback = parseFeedbackSection(sections.feedback);
  const choices = parseKeyValueSection(sections.choices, { allowRepeated: true });
  const seedSpec = parseSeedSpec(metadata.SEED);

  return {
    sections,
    unknownSections: Object.keys(sections).filter(
      name => name !== 'question' && !KNOWN_SECTIONS.has(name)
    ),
    metadata,
    definitions,
    mappings,
    assignments: formula.assignments,
    constraints,
    answerConfig,
    answerConfigs,
    feedback,
    choices,
    seedSpec,
    answerVariable: answerConfig.valueVariable
  };
}

export function instantiateTemplate(templateText, options = {}) {
  const parsed = typeof templateText === 'string'
    ? parseTemplate(templateText)
    : templateText;
  return instantiateParsedTemplate(parsed, options);
}

export function instantiateParsedTemplate(parsed, options = {}) {
  const seed = resolveSeed(parsed.seedSpec, options.seed);
  const random = options.random || createSeededRandom(seed);
  const maxAttempts = Math.max(
    1,
    Math.min(10000, Number(options.maxAttempts || parsed.metadata.MAX_CONSTRAINT_ATTEMPTS || 1000))
  );
  let lastConstraintTrace = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const variables = {};
    parsed.definitions.forEach(definition => {
      variables[definition.name] = generateDefinitionValue(definition.rule, random);
    });

    const mappingTrace = applyMappings(parsed.mappings, variables);
    const earlyConstraints = [];
    const lateConstraints = [];
    parsed.constraints.forEach(constraint => {
      const identifiers = extractIdentifiers(constraint.expression);
      (identifiers.every(name => name in variables) ? earlyConstraints : lateConstraints).push(constraint);
    });
    const earlyConstraintTrace = evaluateConstraints(earlyConstraints, variables);
    lastConstraintTrace = earlyConstraintTrace;
    if (earlyConstraintTrace.some(item => !item.passed)) continue;

    const assignmentTrace = applyAssignments(parsed.assignments, variables);
    const lateConstraintTrace = evaluateConstraints(lateConstraints, variables);
    const constraintTrace = [...earlyConstraintTrace, ...lateConstraintTrace];
    lastConstraintTrace = constraintTrace;
    if (lateConstraintTrace.some(item => !item.passed)) continue;

    const answers = resolveConfiguredAnswers(parsed.answerConfigs, variables);
    const primaryAnswer = answers[0];
    const answer = primaryAnswer.answer;
    const dependencies = resolveAnswerDependencies(parsed);
    const requiredInputs = new Set(
      parsed.definitions
        .map(definition => definition.name)
        .filter(name => dependencies.has(name))
    );
    const questionSegments = renderQuestionSegments(
      parsed.sections.question,
      variables,
      requiredInputs
    );
    const question = questionSegments.map(segment => segment.text).join('');
    const answerUnit = primaryAnswer.answerUnit;
    const formattedAnswer = primaryAnswer.formattedAnswer;
    const acceptedAnswers = primaryAnswer.acceptedAnswers;
    const inputTrace = parsed.definitions.map(definition => ({
      name: definition.name,
      value: variables[definition.name],
      description: definition.description,
      specification: definition.spec,
      required: requiredInputs.has(definition.name)
    }));

    const trace = {
      seed,
      attempt,
      inputs: inputTrace,
      mappings: mappingTrace.map(mapping => ({
        ...mapping,
        outputs: mapping.outputs.map(output => ({
          ...output,
          required: dependencies.has(output.name)
        }))
      })),
      assignments: assignmentTrace.map(step => ({
        ...step,
        required: dependencies.has(step.name)
      })),
      constraints: constraintTrace,
      answerVariable: parsed.answerVariable,
      answerVariables: answers.map(item => item.valueVariable),
      answerDetails: answers,
      answer,
      formattedAnswer,
      answerUnit
    };

    const feedback = {
      hint: renderTemplateText(parsed.feedback.HINT || '', variables),
      solution: renderTemplateText(parsed.feedback.SOLUTION || '', variables),
      explanation: renderTemplateText(parsed.feedback.EXPLANATION || '', variables)
    };

    return {
      question,
      questionSegments,
      answer,
      formattedAnswer,
      answerUnit,
      acceptedAnswers,
      answers,
      answerConfig: { ...parsed.answerConfig },
      answerConfigs: parsed.answerConfigs.map(config => ({ ...config })),
      variables,
      requiredInputs: [...requiredInputs],
      trace,
      seed,
      attempt,
      metadata: { ...parsed.metadata },
      feedback,
      explanation: feedback.solution || feedback.explanation || formatTraceAsText(trace)
    };
  }

  const failed = lastConstraintTrace.filter(item => !item.passed).map(item => item.expression);
  throw new Error(
    `No valid value combination was found after ${maxAttempts} attempts${failed.length ? `; failing constraints included: ${failed.join('; ')}` : ''}.`
  );
}

export function resolveAnswerDependencies(parsed) {
  const graph = new Map();

  parsed.mappings.forEach(mapping => {
    mapping.outputNames.forEach(outputName => graph.set(outputName, [mapping.sourceName]));
  });

  parsed.assignments.forEach(assignment => {
    graph.set(assignment.name, extractIdentifiers(assignment.expression));
  });

  const collected = new Set();
  const visit = name => {
    if (!name || collected.has(name)) return;
    collected.add(name);
    (graph.get(name) || []).forEach(visit);
  };

  (parsed.answerConfigs?.length ? parsed.answerConfigs : [parsed.answerConfig])
    .map(config => config?.valueVariable)
    .filter(Boolean)
    .forEach(visit);
  return collected;
}

export function extractPlaceholders(questionTemplate) {
  return [...String(questionTemplate || '').matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)]
    .map(match => match[1]);
}

export function extractIdentifiers(expression) {
  const identifiers = String(expression || '').match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  return [...new Set(identifiers.filter(name =>
    !ALLOWED_FUNCTIONS.includes(name.toLowerCase())
    && !['AND', 'OR', 'NOT', 'true', 'false'].includes(name)
    && !(name in CONSTANTS)
  ))];
}

export function getDefinitionPossibleValues(definition) {
  if (definition.rule.type === 'fixed') return [definition.rule.value];
  if (definition.rule.type === 'set') return [...definition.rule.values];
  if (definition.rule.type === 'range') {
    const count = getRangeStepCount(definition.rule);
    if (count <= 1000) {
      return Array.from({ length: count + 1 }, (_, index) =>
        normalizeSteppedValue(definition.rule.min + index * definition.rule.step, definition.rule.decimalPlaces)
      );
    }
  }
  return null;
}

export function formatTraceAsText(trace) {
  const lines = [`Seed: ${trace.seed}`, `Accepted generation attempt: ${trace.attempt}`];
  const requiredInputs = trace.inputs.filter(input => input.required);
  if (requiredInputs.length) {
    lines.push('', 'Generated inputs:');
    requiredInputs.forEach(input => lines.push(`${input.name} = ${formatAnswer(input.value)}`));
  }

  const requiredMappings = trace.mappings.flatMap(mapping =>
    mapping.outputs.filter(output => output.required).map(output => ({ mapping, output }))
  );
  if (requiredMappings.length) {
    lines.push('', 'Mappings:');
    requiredMappings.forEach(({ mapping, output }) => {
      lines.push(`${output.name} = map(${mapping.sourceName} = ${formatAnswer(mapping.sourceValue)}) = ${formatAnswer(output.value)}`);
    });
  }

  if (trace.assignments.length) {
    lines.push('', 'Formula evaluation:');
    trace.assignments.filter(step => step.required).forEach(step => {
      lines.push(`${step.name} = ${step.expression}\n  = ${step.substitutedExpression}\n  = ${formatAnswer(step.value)}`);
    });
  }

  if (trace.constraints?.length) {
    lines.push('', 'Constraints:');
    trace.constraints.forEach(item => lines.push(`${item.passed ? 'PASS' : 'FAIL'}: ${item.expression}`));
  }

  if (trace.answerDetails?.length > 1) {
    lines.push('', 'Final answers:');
    trace.answerDetails.forEach(item => lines.push(`${item.label || item.valueVariable}: ${item.formattedAnswer || formatAnswer(item.answer)}`));
  } else {
    lines.push('', `Final answer: ${trace.formattedAnswer || formatAnswer(trace.answer)}`);
  }
  return lines.join('\n');
}

export function createSeededRandom(seed) {
  let value = Number(seed) >>> 0;
  return function seededRandom() {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function splitTemplateSections(text) {
  const source = String(text || '').replace(/\r\n?/g, '\n');
  const matches = [...source.matchAll(/^##\s*([^\n]+?)\s*$/gm)];
  if (!matches.length) throw new Error('Add at least ## Definitions and ## Formula sections.');

  const question = source.slice(0, matches[0].index).trim();
  if (!question) throw new Error('The exercise question is empty.');

  const sections = { question };
  matches.forEach((match, index) => {
    const name = normalizeSectionName(match[1]);
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    if (name in sections) throw new Error(`Duplicate section: ## ${match[1].trim()}.`);
    sections[name] = source.slice(start, end).trim();
  });

  if (!sections.definitions) throw new Error('The template needs a ## Definitions section.');
  if (!sections.formula) throw new Error('The template needs a ## Formula section.');
  return sections;
}

function normalizeSectionName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, '-');
}

function parseKeyValueSection(text, options = {}) {
  const result = {};
  if (!text) return result;
  for (const line of cleanLines(text)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.*)$/i);
    if (!match) throw new Error(`Invalid section entry: “${line}”. Expected KEY: value.`);
    const key = match[1].toUpperCase();
    const value = match[2].trim();
    if (key in result && !options.allowRepeated) throw new Error(`Duplicate term: ${key}.`);
    if (options.allowRepeated) {
      if (!(key in result)) result[key] = [];
      result[key].push(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function parseDefinitions(text) {
  const lines = cleanLines(text);
  if (!lines.length) throw new Error('The Definitions section is empty.');
  const seen = new Set();

  return lines.map(line => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.*?)\s*\((.+)\)\s*$/);
    if (!match) throw new Error(`Invalid definition: “${line}”. Expected NAME: description (value rule).`);
    const name = match[1];
    if (seen.has(name)) throw new Error(`Duplicate definition: ${name}.`);
    seen.add(name);
    const spec = match[3].trim();
    return { name, description: match[2], spec, rule: parseDefinitionRule(spec) };
  });
}

function parseDefinitionRule(spec) {
  const stepped = spec.match(/^(-?\d+(?:\.\d+)?)\s*\.\.\s*(-?\d+(?:\.\d+)?)(?:\s*;\s*step\s*=\s*(\d+(?:\.\d+)?))?$/i);
  const legacy = !stepped && spec.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);
  const range = stepped || legacy;

  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min > max) throw new Error(`Invalid range ${spec}: minimum exceeds maximum.`);
    const decimals = Math.max(decimalCount(range[1]), decimalCount(range[2]), decimalCount(range[3] || ''));
    const defaultStep = decimals ? 1 / (10 ** decimals) : 1;
    const step = range[3] == null ? defaultStep : Number(range[3]);
    if (!(step > 0)) throw new Error(`Invalid range ${spec}: step must be greater than zero.`);
    return { type: 'range', min, max, step, decimalPlaces: decimals, explicitStep: range[3] != null };
  }

  if (spec.includes(',')) {
    const values = splitCommaValues(spec).map(parseScalar);
    if (!values.length) throw new Error(`Empty predefined set: ${spec}`);
    const types = new Set(values.map(value => typeof value));
    if (types.size > 1) throw new Error(`Mixed numeric and text sets are not supported: ${spec}`);
    return { type: 'set', values };
  }

  return { type: 'fixed', value: parseScalar(spec) };
}

function parseMappingsSection(text) {
  if (!text) return [];
  const lines = cleanLines(text);
  const mappings = [];
  let current = null;

  const commit = () => {
    if (!current) return;
    if (!Object.keys(current.values).length) throw new Error(`Mapping ${current.outputName} has no entries.`);
    mappings.push(current);
    current = null;
  };

  for (const line of lines) {
    const header = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*([A-Z][A-Z0-9_]*)\s*$/);
    if (header) {
      commit();
      current = {
        outputName: header[1],
        sourceName: header[2],
        outputNames: [header[1]],
        values: {},
        legacy: false
      };
      continue;
    }

    const compact = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.+)$/);
    if (compact && compact[2].includes('=')) {
      commit();
      mappings.push(parseLegacyMapping(compact[1], compact[2], line));
      continue;
    }

    if (!current) throw new Error(`Mapping entry “${line}” needs a MAPPED_VARIABLE: SOURCE_VARIABLE header.`);
    addMappingPair(current.values, line, current.outputName);
  }
  commit();
  return mappings;
}

function parseFormulaSection(text) {
  const mappings = [];
  const assignments = [];
  const mappingNames = new Set();
  const assignmentNames = new Set();
  const lines = cleanLines(text);
  if (!lines.length) throw new Error('The Formula section is empty.');

  for (const line of lines) {
    const mappingMatch = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.+)$/);
    if (mappingMatch && mappingMatch[2].includes('=')) {
      if (mappingNames.has(mappingMatch[1])) throw new Error(`Duplicate mapping: ${mappingMatch[1]}.`);
      mappingNames.add(mappingMatch[1]);
      mappings.push(parseLegacyMapping(mappingMatch[1], mappingMatch[2], line));
      continue;
    }

    const assignmentMatch = line.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.+)$/);
    if (!assignmentMatch) throw new Error(`Invalid formula line: “${line}”. Use NAME = expression.`);
    if (assignmentNames.has(assignmentMatch[1])) throw new Error(`Duplicate assignment: ${assignmentMatch[1]}.`);
    assignmentNames.add(assignmentMatch[1]);
    assignments.push({ name: assignmentMatch[1], expression: assignmentMatch[2].trim() });
  }

  if (!assignments.length) throw new Error('The Formula section needs at least one assignment, preferably ANSWER = ...');
  return { mappings, assignments };
}

function parseLegacyMapping(name, source, originalLine) {
  const values = {};
  splitCommaValues(source).forEach(pair => addMappingPair(values, pair, name, originalLine));
  return {
    outputName: `${name}_BITS`,
    sourceName: name,
    outputNames: [`${name}_BITS`, `${name}_VALUE`],
    values,
    legacy: true
  };
}

function addMappingPair(values, pair, mappingName, originalLine = pair) {
  const splitIndex = pair.indexOf('=');
  if (splitIndex < 1) throw new Error(`Invalid mapping entry in “${originalLine}”.`);
  const rawKey = pair.slice(0, splitIndex).trim().replace(/^['"]|['"]$/g, '');
  const rawValue = pair.slice(splitIndex + 1).trim();
  if (!rawKey) throw new Error(`Invalid empty mapping key in ${mappingName}.`);
  const key = rawKey.toLowerCase();
  if (key in values) throw new Error(`Duplicate mapping key “${rawKey}” in ${mappingName}.`);
  values[key] = parseScalar(rawValue);
}

function mergeMappings(first, second) {
  const outputNames = new Set();
  return [...first, ...second].map(mapping => {
    mapping.outputNames.forEach(name => {
      if (outputNames.has(name)) throw new Error(`Duplicate mapped output: ${name}.`);
      outputNames.add(name);
    });
    return mapping;
  });
}

function parseConstraints(text) {
  if (!text) return [];
  return cleanLines(text).map(expression => ({ expression }));
}

function parseAnswerSection(text, assignments) {
  const values = parseKeyValueSection(text);
  const fallback = assignments.some(item => item.name === 'ANSWER')
    ? 'ANSWER'
    : assignments.at(-1)?.name || null;
  const round = values.ROUND === undefined || values.ROUND === '' ? null : Number(values.ROUND);
  const tolerance = values.TOLERANCE === undefined || values.TOLERANCE === '' ? null : Number(values.TOLERANCE);
  if (round !== null && (!Number.isInteger(round) || round < 0 || round > 15)) throw new Error('Answer ROUND must be an integer from 0 to 15.');
  if (tolerance !== null && (!(tolerance >= 0) || !Number.isFinite(tolerance))) throw new Error('Answer TOLERANCE must be a non-negative number.');
  return {
    valueVariable: (values.VALUE || fallback || '').trim(),
    unit: (values.UNIT || '').trim(),
    round,
    tolerance,
    toleranceType: (values.TOLERANCE_TYPE || 'absolute').trim().toLowerCase(),
    equivalence: (values.EQUIVALENCE || 'numeric').trim().toLowerCase(),
    acceptedAnswers: splitCommaValues(values.ACCEPT || '').filter(Boolean)
  };
}


function parseAnswersSection(text, fallbackConfig) {
  if (!text) return [fallbackConfig];
  const lines = cleanLines(text);
  if (!lines.length) return [fallbackConfig];
  const configs = [];
  let current = null;

  const commit = () => {
    if (!current) return;
    configs.push(buildAnswerConfig(current.values, current.valueVariable, current.label, fallbackConfig));
    current = null;
  };

  for (const line of lines) {
    if (/^[A-Z][A-Z0-9_]*$/.test(line)) {
      commit();
      current = { valueVariable: line, label: '', values: {} };
      continue;
    }

    const header = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.*)$/);
    if (!header) throw new Error(`Invalid Answers entry: “${line}”. Use VARIABLE or VARIABLE: followed by answer terms.`);
    const key = header[1].toUpperCase();
    const value = header[2].trim();

    if (current && ['LABEL', 'UNIT', 'ROUND', 'TOLERANCE', 'TOLERANCE_TYPE', 'EQUIVALENCE', 'ACCEPT', 'TYPE'].includes(key)) {
      current.values[key] = value;
      continue;
    }

    commit();
    current = { valueVariable: key, label: value, values: {} };
  }
  commit();

  if (!configs.length) throw new Error('The Answers section needs at least one answer variable.');
  const seen = new Set();
  configs.forEach(config => {
    if (seen.has(config.valueVariable)) throw new Error(`Duplicate answer variable in ## Answers: ${config.valueVariable}.`);
    seen.add(config.valueVariable);
  });
  return configs;
}

function buildAnswerConfig(values, valueVariable, label, fallbackConfig = {}) {
  const round = values.ROUND === undefined || values.ROUND === ''
    ? fallbackConfig.round ?? null
    : Number(values.ROUND);
  const tolerance = values.TOLERANCE === undefined || values.TOLERANCE === ''
    ? fallbackConfig.tolerance ?? null
    : Number(values.TOLERANCE);
  if (round !== null && (!Number.isInteger(round) || round < 0 || round > 15)) throw new Error('Answer ROUND must be an integer from 0 to 15.');
  if (tolerance !== null && (!(tolerance >= 0) || !Number.isFinite(tolerance))) throw new Error('Answer TOLERANCE must be a non-negative number.');
  return {
    valueVariable: String(valueVariable || fallbackConfig.valueVariable || '').trim(),
    label: String(values.LABEL || label || valueVariable || fallbackConfig.valueVariable || '').trim(),
    type: String(values.TYPE || 'numeric').trim().toLowerCase(),
    unit: (values.UNIT === undefined ? fallbackConfig.unit : values.UNIT || '').trim(),
    round,
    tolerance,
    toleranceType: (values.TOLERANCE_TYPE || fallbackConfig.toleranceType || 'absolute').trim().toLowerCase(),
    equivalence: (values.EQUIVALENCE || fallbackConfig.equivalence || 'numeric').trim().toLowerCase(),
    acceptedAnswers: splitCommaValues(values.ACCEPT || '').filter(Boolean)
  };
}

function parseFeedbackSection(text) {
  return parseKeyValueSection(text);
}

function parseSeedSpec(value) {
  if (value === undefined || value === '' || String(value).trim().toLowerCase() === 'random') return { type: 'random' };
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 4294967295) {
    throw new Error('SEED must be “random” or an integer from 0 to 4294967295.');
  }
  return { type: 'fixed', value: number >>> 0 };
}

function resolveSeed(seedSpec, override) {
  if (override !== undefined && override !== null && override !== '') return Number(override) >>> 0;
  if (seedSpec?.type === 'fixed') return seedSpec.value >>> 0;
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

function generateDefinitionValue(rule, random) {
  if (rule.type === 'range') {
    const count = getRangeStepCount(rule);
    const index = Math.floor(random() * (count + 1));
    return normalizeSteppedValue(rule.min + index * rule.step, rule.decimalPlaces);
  }
  if (rule.type === 'set') return rule.values[Math.floor(random() * rule.values.length)];
  return rule.value;
}

function getRangeStepCount(rule) {
  return Math.max(0, Math.floor(((rule.max - rule.min) / rule.step) + 1e-10));
}

function normalizeSteppedValue(value, decimalPlaces) {
  return Number(Number(value).toFixed(Math.min(15, Math.max(0, decimalPlaces))));
}

function parseScalar(value) {
  const trimmed = String(value).trim();
  const unquoted = trimmed.replace(/^(['"])([\s\S]*)\1$/, '$2');
  return /^-?\d+(?:\.\d+)?$/.test(unquoted) ? Number(unquoted) : unquoted;
}

function applyMappings(mappings, variables) {
  const traces = [];
  for (const mapping of mappings) {
    const sourceValue = variables[mapping.sourceName];
    if (sourceValue === undefined) throw new Error(`Mapping ${mapping.outputName} uses undefined source variable ${mapping.sourceName}.`);
    const key = String(sourceValue).trim().toLowerCase();
    if (!(key in mapping.values)) throw new Error(`No mapped value exists for ${mapping.sourceName} = ${sourceValue}.`);
    const mappedValue = mapping.values[key];
    const outputs = mapping.outputNames.map(name => ({ name, value: mappedValue }));
    outputs.forEach(output => { variables[output.name] = output.value; });
    traces.push({
      outputName: mapping.outputName,
      sourceName: mapping.sourceName,
      sourceValue,
      selectedKey: key,
      outputs
    });
  }
  return traces;
}

function applyAssignments(assignments, variables) {
  const traces = [];
  for (const assignment of assignments) {
    const substitutedExpression = substituteExpression(assignment.expression, variables);
    const value = evaluateNumericExpression(assignment.expression, variables);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${assignment.name} produced a non-finite result from “${assignment.expression}”.`);
    }
    variables[assignment.name] = value;
    traces.push({
      name: assignment.name,
      expression: assignment.expression,
      substitutedExpression,
      value,
      dependencies: extractIdentifiers(assignment.expression)
    });
  }
  return traces;
}

function evaluateConstraints(constraints, variables) {
  return constraints.map(constraint => {
    const passed = Boolean(evaluateBooleanExpression(constraint.expression, variables));
    return {
      expression: constraint.expression,
      substitutedExpression: substituteExpression(constraint.expression, variables),
      passed
    };
  });
}


function resolveConfiguredAnswers(configs, variables) {
  return (configs || []).map(config => {
    const answer = resolveAnswer(config.valueVariable, variables);
    const answerUnit = resolveTextValue(config.unit, variables);
    const formattedAnswer = formatConfiguredAnswer(answer, config, answerUnit);
    const acceptedAnswers = config.acceptedAnswers.map(value => renderTemplateText(value, variables));
    return {
      id: config.valueVariable,
      valueVariable: config.valueVariable,
      label: config.label || config.valueVariable,
      answer,
      rawAnswer: answer,
      formattedAnswer,
      answerUnit,
      acceptedAnswers,
      answerConfig: { ...config }
    };
  });
}

function resolveAnswer(answerVariable, variables) {
  if (!answerVariable) throw new Error('No answer variable is configured. Add ANSWER = ... or ## Answer with VALUE: VARIABLE.');
  if (!(answerVariable in variables)) throw new Error(`Answer variable ${answerVariable} was not calculated.`);
  const answer = variables[answerVariable];
  if (typeof answer !== 'number' || !Number.isFinite(answer)) throw new Error(`Answer variable ${answerVariable} is not a finite number.`);
  return answer;
}

function renderQuestionSegments(questionTemplate, variables, requiredInputs) {
  const segments = [];
  const pattern = /\{([A-Z][A-Z0-9_]*)\}/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(questionTemplate))) {
    if (match.index > cursor) segments.push({ type: 'text', text: questionTemplate.slice(cursor, match.index) });
    const name = match[1];
    if (!(name in variables)) throw new Error(`Placeholder {${name}} has no definition or derived value.`);
    segments.push({ type: 'value', text: String(variables[name]), variable: name, required: requiredInputs.has(name) });
    cursor = pattern.lastIndex;
  }
  if (cursor < questionTemplate.length) segments.push({ type: 'text', text: questionTemplate.slice(cursor) });
  const unresolved = segments.map(segment => segment.text).join('').match(/\{[^}]+\}/g);
  if (unresolved) throw new Error(`Unresolved placeholder: ${unresolved[0]}`);
  return segments;
}

function renderTemplateText(text, variables) {
  return String(text || '').replace(/\{([A-Z][A-Z0-9_]*)\}/g, (match, name) =>
    name in variables ? String(variables[name]) : match
  );
}

function resolveTextValue(value, variables) {
  if (!value) return '';
  return value in variables ? String(variables[value]) : renderTemplateText(value, variables);
}

function formatConfiguredAnswer(answer, config, unit) {
  const rounded = config.round === null ? answer : Number(answer.toFixed(config.round));
  const value = config.round === null ? formatAnswer(rounded) : rounded.toFixed(config.round);
  return unit ? `${value} ${unit}` : value;
}

function evaluateNumericExpression(expression, variables) {
  return evaluateSanitizedExpression(expression, variables, false);
}

function evaluateBooleanExpression(expression, variables) {
  return evaluateSanitizedExpression(expression, variables, true);
}

function evaluateSanitizedExpression(expression, variables, allowBoolean) {
  const tokens = tokenizeExpression(expression, allowBoolean);
  const rendered = tokens.map(token => {
    const upper = token.toUpperCase();
    const lower = token.toLowerCase();
    if (allowBoolean && upper === 'AND') return '&&';
    if (allowBoolean && upper === 'OR') return '||';
    if (allowBoolean && upper === 'NOT') return '!';
    if (token === '^') return '**';
    if (ALLOWED_FUNCTIONS.includes(lower)) return `Math.${lower === 'pow' ? 'pow' : lower}`;
    if (token in CONSTANTS) return String(CONSTANTS[token]);
    if (/^[A-Za-z_]/.test(token)) {
      if (!(token in variables)) throw new Error(`Unknown ${allowBoolean ? 'constraint' : 'formula'} variable: ${token}`);
      const value = variables[token];
      if (!allowBoolean && typeof value !== 'number') {
        throw new Error(`${token} is text. Add a mapping and use its numeric mapped variable in formulas.`);
      }
      return typeof value === 'string' ? JSON.stringify(value) : String(value);
    }
    return token;
  }).join('');

  try {
    return Function(`"use strict"; return (${rendered});`)();
  } catch (error) {
    throw new Error(`Could not evaluate “${expression}”: ${error.message}`);
  }
}

function tokenizeExpression(expression, allowBoolean) {
  const pattern = allowBoolean
    ? /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<=|>=|==|!=|&&|\|\||[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/%^<>,!]/g
    : /[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/^,.]/g;
  const tokens = String(expression).match(pattern);
  if (!tokens || tokens.join('').replace(/\s/g, '') !== String(expression).replace(/\s/g, '')) {
    throw new Error(`Unsupported characters in ${allowBoolean ? 'constraint' : 'formula'}: ${expression}`);
  }
  return tokens;
}

function substituteExpression(expression, variables) {
  return String(expression).replace(/[A-Z][A-Z0-9_]*/g, name =>
    name in variables ? String(variables[name]) : name
  );
}

function cleanLines(text) {
  return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('//'));
}

function splitCommaValues(text) {
  if (!String(text || '').trim()) return [];
  return String(text).split(',').map(item => item.trim()).filter(Boolean);
}
