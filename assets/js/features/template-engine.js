import {
  decimalCount,
  formatAnswer
} from '../core/utils.js';

const ALLOWED_FUNCTIONS = [
  'abs', 'round', 'floor', 'ceil', 'min', 'max', 'sqrt', 'pow',
  'count', 'sum', 'average', 'row', 'column', 'cell', 'contains',
  'field', 'sort', 'unique'
];
const CONSTANTS = { PI: Math.PI, E: Math.E };
const SEMANTIC_TYPES = new Set([
  'semantic', 'semantic-answer', 'semantic-explanation', 'definition',
  'comparison', 'reasoning', 'phrase-completion', 'valid-statement', 'stated-answer'
]);
const KNOWN_SECTIONS = new Set([
  'metadata', 'definitions', 'mappings', 'formula', 'constraints',
  'answer', 'answers', 'repeated-answers', 'semantic-answer', 'choices',
  'collections', 'feedback'
]);

export function parseTemplate(templateText) {
  const sections = splitTemplateSections(templateText);
  const metadata = parseKeyValueSection(sections.metadata);
  const semanticAnswer = parseSemanticAnswerSection(sections['semantic-answer']);
  const semantic = isSemanticTemplateMetadata(metadata) || Boolean(sections['semantic-answer']);
  const definitions = parseDefinitions(sections.definitions, { optional: semantic || Boolean(sections.collections) });
  const collections = parseCollectionsSection(sections.collections);
  const explicitMappings = parseMappingsSection(sections.mappings);
  const formula = parseFormulaSection(sections.formula, { optional: semantic || Boolean(sections['repeated-answers']) });
  const mappings = mergeMappings(explicitMappings, formula.mappings);
  const constraints = parseConstraints(sections.constraints);
  const answerConfig = semantic
    ? createSemanticAnswerConfig(semanticAnswer)
    : parseAnswerSection(sections.answer, formula.assignments);
  const answerConfigs = semantic
    ? [answerConfig]
    : (!sections.answers && !sections.answer && !formula.assignments.length && sections['repeated-answers'])
      ? []
      : parseAnswersSection(sections.answers, answerConfig);
  const repeatedAnswerConfigs = semantic
    ? []
    : parseRepeatedAnswersSection(sections['repeated-answers'], answerConfig);
  const feedback = parseFeedbackSection(sections.feedback);
  const choices = parseKeyValueSection(sections.choices, { allowRepeated: true });
  const seedSpec = parseSeedSpec(metadata.SEED);
  validateCollectionNamespaces(definitions, collections, mappings, formula.assignments);

  if (semantic && !semanticAnswer.REFERENCE) {
    throw new Error('Semantic templates need ## Semantic Answer with REFERENCE: text.');
  }

  return {
    sections,
    unknownSections: Object.keys(sections).filter(
      name => name !== 'question' && !KNOWN_SECTIONS.has(name)
    ),
    metadata,
    definitions,
    collections,
    mappings,
    assignments: formula.assignments,
    constraints,
    answerConfig,
    answerConfigs,
    repeatedAnswerConfigs,
    semanticAnswer,
    semantic,
    feedback,
    choices,
    seedSpec,
    answerVariable: answerConfig.valueVariable
  };
}

export function isSemanticTemplate(templateOrParsed) {
  const parsed = typeof templateOrParsed === 'string' ? parseTemplate(templateOrParsed) : templateOrParsed;
  return Boolean(parsed?.semantic);
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
    const collectionTrace = generateCollections(parsed.collections, variables, random);
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

    if (parsed.semantic) {
      return buildSemanticTemplateInstance({
        parsed,
        variables,
        mappingTrace,
        collectionTrace,
        assignmentTrace,
        constraintTrace,
        seed,
        attempt
      });
    }

    const standardAnswers = resolveConfiguredAnswers(parsed.answerConfigs, variables);
    const repeatedAnswers = resolveRepeatedAnswers(parsed.repeatedAnswerConfigs, variables);
    const answers = [...standardAnswers, ...repeatedAnswers];
    const primaryAnswer = answers[0];
    const dependencies = resolveAnswerDependencies(parsed);
    const requiredInputs = new Set(
      parsed.definitions
        .map(definition => definition.name)
        .filter(name => dependencies.has(name))
    );
    const requiredCollections = new Set(
      parsed.collections
        .map(collection => collection.name)
        .filter(name => dependencies.has(name))
    );
    const questionSegments = renderQuestionSegments(
      parsed.sections.question,
      variables,
      requiredInputs,
      requiredCollections,
      parsed.collections
    );
    const question = questionSegments.map(segment => segment.text).join('');
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
      collections: collectionTrace.map(item => ({
        ...item,
        required: requiredCollections.has(item.name)
      })),
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
      answerVariable: primaryAnswer.valueVariable,
      answerVariables: answers.map(item => item.valueVariable),
      answerDetails: answers,
      answer: primaryAnswer.answer,
      formattedAnswer: primaryAnswer.formattedAnswer,
      answerUnit: primaryAnswer.answerUnit
    };

    const feedback = renderFeedback(parsed.feedback, variables);

    return {
      kind: 'deterministic',
      question,
      questionSegments,
      answer: primaryAnswer.answer,
      formattedAnswer: primaryAnswer.formattedAnswer,
      answerUnit: primaryAnswer.answerUnit,
      acceptedAnswers: primaryAnswer.acceptedAnswers,
      answers,
      answerConfig: { ...primaryAnswer.answerConfig },
      answerConfigs: parsed.answerConfigs.map(config => ({ ...config })),
      variables,
      requiredInputs: [...requiredInputs],
      requiredCollections: [...requiredCollections],
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

  parsed.collections.forEach(collection => {
    const expressions = [collection.countExpression, collection.rowsExpression, collection.columnsExpression]
      .filter(Boolean);
    graph.set(collection.name, expressions.flatMap(extractIdentifiers));
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

  if (parsed.semantic) {
    extractPlaceholders(parsed.semanticAnswer?.REFERENCE || '').forEach(visit);
    extractPlaceholders(parsed.sections.question || '').forEach(visit);
  } else {
    (parsed.answerConfigs?.length ? parsed.answerConfigs : [parsed.answerConfig])
      .map(config => config?.valueVariable)
      .filter(Boolean)
      .forEach(visit);
    (parsed.repeatedAnswerConfigs || []).forEach(config => {
      visit(config.source);
      extractIdentifiers(config.valueExpression || '').forEach(visit);
    });
  }
  return collected;
}

export function extractPlaceholders(questionTemplate) {
  return [...String(questionTemplate || '').matchAll(/\{([A-Z][A-Z0-9_]*)\}/g)]
    .map(match => match[1]);
}

export function extractIdentifiers(expression) {
  const withoutStrings = String(expression || '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
  const identifiers = withoutStrings.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
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

  const requiredCollections = (trace.collections || []).filter(item => item.required);
  if (requiredCollections.length) {
    lines.push('', 'Generated collections:');
    requiredCollections.forEach(item => {
      lines.push(`${item.name}:`);
      lines.push(formatCollectionPlain(item.value));
    });
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

  if (trace.semantic) {
    lines.push('', `Reference answer: ${trace.referenceAnswer || ''}`);
  } else if (trace.answerDetails?.length > 1) {
    lines.push('', 'Final answers:');
    trace.answerDetails.forEach(item => {
      lines.push(`${item.label || item.valueVariable}: ${item.formattedAnswer || formatAnswer(item.answer)}`);
    });
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
  if (!matches.length) throw new Error('Add at least one template section.');

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

  const metadata = parseKeyValueSection(sections.metadata);
  const semantic = isSemanticTemplateMetadata(metadata) || Boolean(sections['semantic-answer']);
  if (!semantic) {
    if (!sections.definitions && !sections.collections) {
      throw new Error('The template needs a ## Definitions or ## Collections section.');
    }
    if (!sections.formula && !sections['repeated-answers']) {
      throw new Error('The template needs a ## Formula or ## Repeated Answers section.');
    }
  }
  return sections;
}

function normalizeSectionName(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, '-');
}

function parseKeyValueSection(text, options = {}) {
  const result = {};
  if (!text) return result;
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  let blockKey = null;
  let blockLines = [];

  const store = (key, value) => {
    if (key in result && !options.allowRepeated) throw new Error(`Duplicate term: ${key}.`);
    if (options.allowRepeated) {
      if (!(key in result)) result[key] = [];
      result[key].push(value);
    } else {
      result[key] = value;
    }
  };
  const commitBlock = () => {
    if (!blockKey) return;
    while (blockLines.length && !blockLines[0].trim()) blockLines.shift();
    while (blockLines.length && !blockLines.at(-1).trim()) blockLines.pop();
    store(blockKey, blockLines.map(line => line.trim()).join('\n'));
    blockKey = null;
    blockLines = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const match = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.*)$/i);
    if (match) {
      commitBlock();
      const key = match[1].toUpperCase();
      const value = match[2].trim();
      if (value === '|') {
        blockKey = key;
        blockLines = [];
      } else {
        store(key, value);
      }
      continue;
    }
    if (blockKey) {
      if (trimmed.startsWith('//')) continue;
      blockLines.push(rawLine);
      continue;
    }
    if (!trimmed || trimmed.startsWith('//')) continue;
    throw new Error(`Invalid section entry: “${trimmed}”. Expected KEY: value.`);
  }
  commitBlock();
  return result;
}

function parseDefinitions(text, options = {}) {
  const lines = cleanLines(text);
  if (!lines.length) {
    if (options.optional) return [];
    throw new Error('The Definitions section is empty.');
  }
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

function validateCollectionNamespaces(definitions, collections, mappings, assignments) {
  const scalarNames = new Set(definitions.map(item => item.name));
  mappings.forEach(mapping => mapping.outputNames.forEach(name => scalarNames.add(name)));
  assignments.forEach(assignment => scalarNames.add(assignment.name));
  collections.forEach(collection => {
    if (scalarNames.has(collection.name)) {
      throw new Error(`Collection ${collection.name} conflicts with a scalar definition, mapping, or formula variable.`);
    }
  });
}

function parseCollectionsSection(text) {
  if (!String(text || '').trim()) return [];
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const collections = [];
  let current = null;

  const commit = () => {
    if (!current) return;
    const type = String(current.settings.TYPE || '').trim().toLowerCase();
    if (!['matrix', 'grid', 'list'].includes(type)) {
      throw new Error(`Collection ${current.name} needs TYPE: matrix, grid, or list.`);
    }
    if (type === 'matrix' || type === 'grid') {
      if (!current.settings.ROWS || !current.settings.COLUMNS || !current.settings.VALUE) {
        throw new Error(`Collection ${current.name} needs ROWS, COLUMNS, and VALUE.`);
      }
      collections.push({
        name: current.name,
        type: 'matrix',
        rowsExpression: current.settings.ROWS,
        columnsExpression: current.settings.COLUMNS,
        valueRule: parseDefinitionRule(current.settings.VALUE),
        fields: []
      });
    } else {
      if (!current.settings.COUNT) throw new Error(`List ${current.name} needs COUNT.`);
      const fields = current.fields.map(field => ({
        name: field.name,
        rule: parseDefinitionRule(field.spec),
        spec: field.spec
      }));
      if (!fields.length && !current.settings.VALUE) {
        throw new Error(`List ${current.name} needs VALUE or at least one FIELD NAME: value rule entry.`);
      }
      collections.push({
        name: current.name,
        type: 'list',
        countExpression: current.settings.COUNT,
        valueRule: current.settings.VALUE ? parseDefinitionRule(current.settings.VALUE) : null,
        fields
      });
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const header = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*$/);
    if (header) {
      commit();
      current = { name: header[1], settings: {}, fields: [] };
      continue;
    }
    if (!current) throw new Error(`Collection entry “${line}” needs a COLLECTION_NAME: header.`);
    const field = line.match(/^FIELD\s+([A-Z][A-Z0-9_]*)\s*:\s*(.+)$/i);
    if (field) {
      const reservedFields = new Set(['INDEX', 'INDEX0', 'ROW_INDEX', 'ROW_INDEX0', 'COLUMN_INDEX', 'COLUMN_INDEX0', 'VALUE', 'VALUES', 'SOURCE_NAME']);
      if (reservedFields.has(field[1])) throw new Error(`Collection field ${field[1]} is reserved for generated item context.`);
      if (current.fields.some(item => item.name === field[1])) throw new Error(`Duplicate field ${field[1]} in ${current.name}.`);
      current.fields.push({ name: field[1], spec: field[2].trim() });
      continue;
    }
    const setting = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.+)$/i);
    if (!setting) throw new Error(`Invalid collection entry: “${line}”.`);
    const key = setting[1].toUpperCase();
    if (key in current.settings) throw new Error(`Duplicate ${key} in collection ${current.name}.`);
    current.settings[key] = setting[2].trim();
  }
  commit();

  const names = new Set();
  collections.forEach(collection => {
    if (names.has(collection.name)) throw new Error(`Duplicate collection: ${collection.name}.`);
    names.add(collection.name);
  });
  return collections;
}

function parseRepeatedAnswersSection(text, fallbackConfig) {
  if (!String(text || '').trim()) return [];
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const configs = [];
  let current = null;

  const commit = () => {
    if (!current) return;
    const values = current.values;
    if (!values.SOURCE) throw new Error(`Repeated answer ${current.name} needs SOURCE.`);
    if (!values.VALUE) throw new Error(`Repeated answer ${current.name} needs VALUE.`);
    const normalized = normalizeAnswerConfig(values, current.name, fallbackConfig);
    const mode = String(values.MODE || 'items').trim().toLowerCase();
    if (!['items', 'columns'].includes(mode)) {
      throw new Error(`Repeated answer ${current.name} MODE must be items or columns.`);
    }
    configs.push({
      ...normalized,
      groupName: current.name,
      source: values.SOURCE.trim(),
      mode,
      valueExpression: values.VALUE.trim(),
      labelTemplate: String(values.LABEL || `${current.name} {INDEX}`).trim()
    });
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const header = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*$/);
    if (header) {
      commit();
      current = { name: header[1], values: {} };
      continue;
    }
    const setting = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.*)$/i);
    if (!setting || !current) throw new Error(`Invalid Repeated Answers entry: “${line}”.`);
    current.values[setting[1].toUpperCase()] = setting[2].trim();
  }
  commit();
  return configs;
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

function parseFormulaSection(text, options = {}) {
  const mappings = [];
  const assignments = [];
  const mappingNames = new Set();
  const assignmentNames = new Set();
  const lines = cleanLines(text);
  if (!lines.length) {
    if (options.optional) return { mappings, assignments };
    throw new Error('The Formula section is empty.');
  }

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

  if (!assignments.length && !options.optional) throw new Error('The Formula section needs at least one assignment, preferably ANSWER = ...');
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
    label: (values.LABEL || values.VALUE || fallback || 'Answer').trim(),
    type: (values.TYPE || 'numeric').trim().toLowerCase(),
    unit: (values.UNIT || '').trim(),
    round,
    tolerance,
    toleranceType: (values.TOLERANCE_TYPE || 'absolute').trim().toLowerCase(),
    equivalence: (values.EQUIVALENCE || 'numeric').trim().toLowerCase(),
    acceptedAnswers: splitCommaValues(values.ACCEPT || '').filter(Boolean)
  };
}

function parseAnswersSection(text, fallbackConfig) {
  if (!String(text || '').trim()) return [fallbackConfig];
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const configs = [];
  let current = null;

  const commit = () => {
    if (!current) return;
    configs.push(normalizeAnswerConfig(current.values, current.valueVariable, fallbackConfig));
    current = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const header = line.match(/^([A-Z][A-Z0-9_]*)\s*:?\s*$/);
    if (header) {
      commit();
      current = { valueVariable: header[1], values: {} };
      continue;
    }
    const setting = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.*)$/i);
    if (!setting || !current) {
      throw new Error(`Invalid Answers entry: “${line}”. Start each answer with VARIABLE_NAME:`);
    }
    current.values[setting[1].toUpperCase()] = setting[2].trim();
  }
  commit();
  if (!configs.length) throw new Error('The Answers section is empty.');
  return configs;
}

function normalizeAnswerConfig(values, valueVariable, fallback = {}) {
  const round = values.ROUND === undefined || values.ROUND === ''
    ? (fallback.round ?? null)
    : Number(values.ROUND);
  const tolerance = values.TOLERANCE === undefined || values.TOLERANCE === ''
    ? (fallback.tolerance ?? null)
    : Number(values.TOLERANCE);
  if (round !== null && (!Number.isInteger(round) || round < 0 || round > 15)) {
    throw new Error('Answer ROUND must be an integer from 0 to 15.');
  }
  if (tolerance !== null && (!(tolerance >= 0) || !Number.isFinite(tolerance))) {
    throw new Error('Answer TOLERANCE must be a non-negative number.');
  }
  return {
    valueVariable: String(valueVariable || values.VALUE || fallback.valueVariable || '').trim(),
    label: String(values.LABEL || valueVariable || fallback.label || '').trim(),
    type: String(values.TYPE || fallback.type || 'numeric').trim().toLowerCase(),
    unit: String(values.UNIT ?? fallback.unit ?? '').trim(),
    round,
    tolerance,
    toleranceType: String(values.TOLERANCE_TYPE || fallback.toleranceType || 'absolute').trim().toLowerCase(),
    equivalence: String(values.EQUIVALENCE || fallback.equivalence || 'numeric').trim().toLowerCase(),
    acceptedAnswers: splitCommaValues(values.ACCEPT ?? '').length
      ? splitCommaValues(values.ACCEPT).filter(Boolean)
      : [...(fallback.acceptedAnswers || [])]
  };
}

function parseSemanticAnswerSection(text) {
  if (!String(text || '').trim()) return {};
  const supported = new Set([
    'REFERENCE', 'STRICTNESS', 'ESSENTIAL_CONCEPTS', 'SUPPORTING_CONCEPTS',
    'ACCEPTED_EXPRESSIONS', 'KNOWN_INCORRECT_CLAIMS'
  ]);
  const result = {};
  let currentKey = null;
  let blockMode = false;
  for (const rawLine of String(text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    const match = line.match(/^([A-Z][A-Z0-9_]*)\s*:\s*(.*)$/i);
    if (match && supported.has(match[1].toUpperCase())) {
      currentKey = match[1].toUpperCase();
      blockMode = match[2].trim() === '|';
      result[currentKey] = blockMode ? '' : match[2].trim();
      continue;
    }
    if (!line || line.startsWith('//')) {
      if (blockMode && currentKey && result[currentKey]) result[currentKey] += '\n';
      continue;
    }
    if (!currentKey) throw new Error(`Invalid Semantic Answer entry: “${line}”.`);
    result[currentKey] = result[currentKey]
      ? `${result[currentKey]}${blockMode ? '\n' : ' '}${line}`
      : line;
  }
  Object.keys(result).forEach(key => { result[key] = String(result[key]).trim(); });
  return result;
}

function createSemanticAnswerConfig(values = {}) {
  return {
    valueVariable: '',
    label: 'Reference answer',
    type: 'semantic',
    unit: '',
    round: null,
    tolerance: null,
    toleranceType: 'absolute',
    equivalence: 'semantic',
    acceptedAnswers: [],
    referenceAnswer: String(values.REFERENCE || '').trim(),
    strictness: normalizeStrictnessValue(values.STRICTNESS),
    essentialConcepts: parseSemanticList(values.ESSENTIAL_CONCEPTS),
    supportingConcepts: parseSemanticList(values.SUPPORTING_CONCEPTS),
    acceptedExpressions: parseSemanticList(values.ACCEPTED_EXPRESSIONS),
    knownIncorrectClaims: parseSemanticList(values.KNOWN_INCORRECT_CLAIMS)
  };
}

function parseSemanticList(value) {
  if (!String(value || '').trim()) return [];
  return String(value).split(/\s*;\s*|\s*\|\s*/).map(item => item.trim()).filter(Boolean);
}

function normalizeStrictnessValue(value) {
  const normalized = String(value || 'moderate').trim().toLowerCase();
  return ['lenient', 'moderate', 'strict', 'exacting'].includes(normalized)
    ? normalized
    : 'moderate';
}

function isSemanticTemplateMetadata(metadata = {}) {
  return SEMANTIC_TYPES.has(String(metadata.TYPE || '').trim().toLowerCase());
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

function generateCollections(collections, variables, random) {
  const trace = [];
  for (const collection of collections || []) {
    if (collection.type === 'matrix') {
      const rows = resolveCollectionSize(collection.rowsExpression, variables, random, `${collection.name} ROWS`);
      const columns = resolveCollectionSize(collection.columnsExpression, variables, random, `${collection.name} COLUMNS`);
      const value = Array.from({ length: rows }, () =>
        Array.from({ length: columns }, () => generateDefinitionValue(collection.valueRule, random))
      );
      variables[collection.name] = value;
      trace.push({ name: collection.name, type: 'matrix', rows, columns, value });
      continue;
    }

    const count = resolveCollectionSize(collection.countExpression, variables, random, `${collection.name} COUNT`);
    const value = Array.from({ length: count }, (_, index) => {
      if (collection.valueRule) return generateDefinitionValue(collection.valueRule, random);
      const record = { INDEX: index + 1, INDEX0: index };
      collection.fields.forEach(field => {
        record[field.name] = generateDefinitionValue(field.rule, random);
      });
      return record;
    });
    variables[collection.name] = value;
    trace.push({
      name: collection.name,
      type: 'list',
      count,
      fields: collection.fields.map(field => field.name),
      value
    });
  }
  return trace;
}

function resolveCollectionSize(expression, variables, random, label) {
  const source = String(expression || '').trim();
  let value;
  if (/^-?\d+(?:\.\d+)?(?:\s*\.\.\s*-?\d+(?:\.\d+)?(?:\s*;\s*step\s*=\s*\d+(?:\.\d+)?)?)?$/.test(source)
      || (source.includes(',') && !/[A-Za-z_]/.test(source))) {
    value = generateDefinitionValue(parseDefinitionRule(source), random);
  } else {
    value = evaluateNumericExpression(source, variables);
  }
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(`${label} must generate or evaluate to an integer from 1 to 100.`);
  }
  return value;
}

function resolveRepeatedAnswers(configs, variables) {
  const answers = [];
  for (const config of configs || []) {
    const source = variables[config.source];
    if (!Array.isArray(source)) throw new Error(`Repeated answer ${config.groupName} uses missing collection ${config.source}.`);
    const mode = config.mode === 'columns' ? 'columns' : 'items';
    if (mode === 'columns' && !source.every(item => Array.isArray(item))) {
      throw new Error(`Repeated answer ${config.groupName} can use MODE: columns only with a matrix collection.`);
    }
    const items = mode === 'columns'
      ? Array.from({ length: source[0]?.length || 0 }, (_, index) => source.map(rowValue => rowValue[index]))
      : source;
    items.forEach((item, index) => {
      const local = createCollectionItemContext(item, index, config.source, mode);
      const scope = { ...variables, ...local };
      const answer = evaluateNumericExpression(config.valueExpression, scope);
      if (typeof answer !== 'number' || !Number.isFinite(answer)) {
        throw new Error(`Repeated answer ${config.groupName} item ${index + 1} did not produce a finite number.`);
      }
      const id = `${config.groupName}_${index + 1}`;
      const answerUnit = resolveTextValue(config.unit, scope);
      const answerConfig = { ...config, valueVariable: id };
      answers.push({
        id,
        valueVariable: id,
        label: renderTemplateText(config.labelTemplate, scope),
        answer,
        answerUnit,
        formattedAnswer: formatConfiguredAnswer(answer, config, answerUnit),
        acceptedAnswers: (config.acceptedAnswers || []).map(value => renderTemplateText(value, scope)),
        answerConfig
      });
    });
  }
  return answers;
}

function createCollectionItemContext(item, index, sourceName, mode = 'items') {
  const base = {
    INDEX: index + 1,
    INDEX0: index,
    SOURCE_NAME: sourceName
  };
  if (mode === 'columns') {
    return { ...base, COLUMN_INDEX: index + 1, COLUMN_INDEX0: index, VALUES: item, VALUE: item };
  }
  if (Array.isArray(item)) {
    return { ...base, ROW_INDEX: index + 1, ROW_INDEX0: index, VALUES: item, VALUE: item };
  }
  if (item && typeof item === 'object') return { ...base, ...item, VALUE: item };
  return { ...base, VALUE: item };
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
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`${assignment.name} produced a non-finite result from “${assignment.expression}”.`);
    }
    if (value === undefined) {
      throw new Error(`${assignment.name} produced no result from “${assignment.expression}”.`);
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
  return (configs || []).map((config, index) => {
    const valueVariable = config.valueVariable;
    if (!valueVariable) throw new Error('No answer variable is configured. Add ANSWER = ... or configure ## Answer / ## Answers.');
    if (!(valueVariable in variables)) throw new Error(`Answer variable ${valueVariable} was not calculated.`);
    const answer = variables[valueVariable];
    if (typeof answer !== 'number' || !Number.isFinite(answer)) {
      throw new Error(`Answer variable ${valueVariable} is not a finite number.`);
    }
    const answerUnit = resolveTextValue(config.unit, variables);
    return {
      id: valueVariable,
      valueVariable,
      label: config.label || `Answer ${index + 1}`,
      answer,
      answerUnit,
      formattedAnswer: formatConfiguredAnswer(answer, config, answerUnit),
      acceptedAnswers: (config.acceptedAnswers || []).map(value => renderTemplateText(value, variables)),
      answerConfig: { ...config }
    };
  });
}

function buildSemanticTemplateInstance({
  parsed,
  variables,
  mappingTrace,
  collectionTrace,
  assignmentTrace,
  constraintTrace,
  seed,
  attempt
}) {
  const requiredNames = new Set(extractPlaceholders(parsed.sections.question));
  const requiredCollections = new Set(
    parsed.collections
      .map(collection => collection.name)
      .filter(name => templateUsesCollection(parsed.sections.question, name))
  );
  const questionSegments = renderQuestionSegments(
    parsed.sections.question,
    variables,
    requiredNames,
    requiredCollections,
    parsed.collections
  );
  const question = questionSegments.map(segment => segment.text).join('');
  const referenceAnswer = renderTemplateText(parsed.semanticAnswer.REFERENCE, variables).trim();
  if (!referenceAnswer) throw new Error('The semantic reference answer is empty after template generation.');
  const feedback = renderFeedback(parsed.feedback, variables);
  const semanticConfig = {
    strictness: normalizeStrictnessValue(parsed.semanticAnswer.STRICTNESS),
    referenceAnswer,
    essentialConcepts: parseSemanticList(renderTemplateText(parsed.semanticAnswer.ESSENTIAL_CONCEPTS || '', variables)),
    supportingConcepts: parseSemanticList(renderTemplateText(parsed.semanticAnswer.SUPPORTING_CONCEPTS || '', variables)),
    acceptedExpressions: parseSemanticList(renderTemplateText(parsed.semanticAnswer.ACCEPTED_EXPRESSIONS || '', variables)),
    knownIncorrectClaims: parseSemanticList(renderTemplateText(parsed.semanticAnswer.KNOWN_INCORRECT_CLAIMS || '', variables)),
    conceptSource: 'manual'
  };
  const inputs = parsed.definitions.map(definition => ({
    name: definition.name,
    value: variables[definition.name],
    description: definition.description,
    specification: definition.spec,
    required: requiredNames.has(definition.name)
  }));
  const trace = {
    semantic: true,
    seed,
    attempt,
    inputs,
    collections: (collectionTrace || []).map(item => ({
      ...item,
      required: requiredCollections.has(item.name)
    })),
    mappings: mappingTrace.map(mapping => ({
      ...mapping,
      outputs: mapping.outputs.map(output => ({
        ...output,
        required: requiredNames.has(output.name)
      }))
    })),
    assignments: assignmentTrace.map(step => ({
      ...step,
      required: requiredNames.has(step.name)
    })),
    constraints: constraintTrace,
    referenceAnswer
  };
  return {
    kind: 'semantic',
    validationKind: 'semantic',
    question,
    questionSegments,
    answer: referenceAnswer,
    formattedAnswer: referenceAnswer,
    answerUnit: '',
    acceptedAnswers: [],
    answers: [],
    answerConfig: { ...parsed.answerConfig },
    answerConfigs: [{ ...parsed.answerConfig }],
    semanticConfig,
    variables,
    requiredInputs: [...requiredNames],
    requiredCollections: [...requiredCollections],
    trace,
    seed,
    attempt,
    metadata: { ...parsed.metadata },
    feedback,
    explanation: feedback.solution || feedback.explanation || referenceAnswer
  };
}

function renderFeedback(feedback, variables) {
  return {
    hint: renderTemplateText(feedback.HINT || '', variables),
    solution: renderTemplateText(feedback.SOLUTION || '', variables),
    explanation: renderTemplateText(feedback.EXPLANATION || '', variables)
  };
}

function renderQuestionSegments(questionTemplate, variables, requiredInputs, requiredCollections = new Set(), collectionDefinitions = []) {
  const segments = renderStructuredSegments(String(questionTemplate || ''), variables, {
    requiredInputs,
    requiredCollections,
    collectionDefinitions
  });
  const rendered = segments.map(segment => segment.text).join('');
  const unresolved = rendered.match(/\{\{[^}]+\}\}|\{[^}]+\}/g);
  if (unresolved) throw new Error(`Unresolved template directive or placeholder: ${unresolved[0]}`);
  return segments;
}

function renderStructuredSegments(source, variables, options) {
  const segments = [];
  let cursor = 0;
  const directivePattern = /\{\{#(?:if|each)\b[^}]*\}\}|\{\{matrix\s+[A-Z][A-Z0-9_]*\s*\}\}/g;
  let match;

  while ((match = directivePattern.exec(source))) {
    if (match.index > cursor) segments.push(...renderInlineSegments(source.slice(cursor, match.index), variables, options));
    const directive = match[0];
    const matrixMatch = directive.match(/^\{\{matrix\s+([A-Z][A-Z0-9_]*)\s*\}\}$/);
    if (matrixMatch) {
      const name = matrixMatch[1];
      if (!(name in variables) || !Array.isArray(variables[name])) throw new Error(`Matrix directive uses missing collection ${name}.`);
      segments.push({
        type: 'value',
        text: formatCollectionPlain(variables[name]),
        variable: name,
        required: options.requiredCollections.has(name),
        collection: true
      });
      cursor = directivePattern.lastIndex;
      continue;
    }

    const opening = directive.match(/^\{\{#(if|each)\s+(.+?)\s*\}\}$/);
    if (!opening) throw new Error(`Invalid template directive: ${directive}`);
    const kind = opening[1];
    const argument = opening[2].trim();
    const block = findStructuredBlock(source, directivePattern.lastIndex, kind);
    if (!block) throw new Error(`Missing {{/${kind}}} for ${directive}.`);
    const body = source.slice(directivePattern.lastIndex, block.elseStart ?? block.closeStart);
    const alternate = block.elseStart == null ? '' : source.slice(block.elseEnd, block.closeStart);

    if (kind === 'if') {
      const passed = Boolean(evaluateBooleanExpression(argument, variables));
      segments.push(...renderStructuredSegments(passed ? body : alternate, variables, options));
    } else {
      if (!/^[A-Z][A-Z0-9_]*$/.test(argument)) throw new Error(`Each directive requires a collection name, received “${argument}”.`);
      const collection = variables[argument];
      if (!Array.isArray(collection)) throw new Error(`Each directive uses missing collection ${argument}.`);
      collection.forEach((item, index) => {
        const local = createCollectionItemContext(item, index, argument);
        segments.push(...renderStructuredSegments(body, { ...variables, ...local }, {
          ...options,
          activeCollection: argument
        }));
      });
    }
    cursor = block.closeEnd;
    directivePattern.lastIndex = cursor;
  }

  if (cursor < source.length) segments.push(...renderInlineSegments(source.slice(cursor), variables, options));
  return segments;
}

function findStructuredBlock(source, contentStart, expectedKind) {
  const tokenPattern = /\{\{#(if|each)\b[^}]*\}\}|\{\{else\}\}|\{\{\/(if|each)\}\}/g;
  tokenPattern.lastIndex = contentStart;
  let depth = 1;
  let elseStart = null;
  let elseEnd = null;
  let match;
  while ((match = tokenPattern.exec(source))) {
    if (match[1]) {
      depth += 1;
      continue;
    }
    if (match[0] === '{{else}}' && depth === 1 && expectedKind === 'if') {
      elseStart = match.index;
      elseEnd = tokenPattern.lastIndex;
      continue;
    }
    if (match[2]) {
      depth -= 1;
      if (depth === 0) {
        if (match[2] !== expectedKind) throw new Error(`Mismatched template closing directive {{/${match[2]}}}.`);
        return { elseStart, elseEnd, closeStart: match.index, closeEnd: tokenPattern.lastIndex };
      }
    }
  }
  return null;
}

function renderInlineSegments(text, variables, options) {
  const segments = [];
  const pattern = /\{([A-Z][A-Z0-9_]*)\}/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) segments.push({ type: 'text', text: text.slice(cursor, match.index) });
    const name = match[1];
    if (!(name in variables)) throw new Error(`Placeholder {${name}} has no definition, collection field, or derived value.`);
    const value = variables[name];
    const collectionName = options.activeCollection || (options.requiredCollections.has(name) ? name : null);
    const required = options.requiredInputs.has(name)
      || (collectionName ? options.requiredCollections.has(collectionName) : false);
    segments.push({
      type: 'value',
      text: formatTemplateValue(value),
      variable: collectionName ? `${collectionName}.${name}` : name,
      required,
      collection: Array.isArray(value)
    });
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) });
  return segments;
}

function renderTemplateText(text, variables) {
  const requiredInputs = new Set();
  const requiredCollections = new Set();
  Object.keys(variables).forEach(name => {
    if (Array.isArray(variables[name])) requiredCollections.add(name);
  });
  return renderStructuredSegments(String(text || ''), variables, {
    requiredInputs,
    requiredCollections,
    collectionDefinitions: []
  }).map(segment => segment.text).join('');
}

function formatTemplateValue(value) {
  if (Array.isArray(value)) return formatCollectionPlain(value);
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !['INDEX', 'INDEX0'].includes(key))
      .map(([key, item]) => `${key}=${formatTemplateValue(item)}`)
      .join(', ');
  }
  return String(value);
}

function formatCollectionPlain(collection) {
  if (!Array.isArray(collection)) return formatTemplateValue(collection);
  if (!collection.length) return '';
  if (collection.every(item => Array.isArray(item))) {
    return collection.map(rowValue => rowValue.map(formatTemplateValue).join(' ')).join('\n');
  }
  if (collection.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
    return collection.map((item, index) => {
      const values = Object.entries(item)
        .filter(([key]) => !['INDEX', 'INDEX0'].includes(key))
        .map(([key, value]) => `${key}=${formatTemplateValue(value)}`)
        .join(', ');
      return `${index + 1}. ${values}`;
    }).join('\n');
  }
  return collection.map(formatTemplateValue).join(', ');
}

function templateUsesCollection(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\{\\{(?:matrix|#each)\\s+${escaped}(?:\\s|\\}\\})`).test(String(text || ''))
    || new RegExp(`\\{${escaped}\\}`).test(String(text || ''));
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
  const identifiers = tokens.filter(token => /^[A-Za-z_][A-Za-z0-9_]*$/.test(token));
  for (const identifier of identifiers) {
    const upper = identifier.toUpperCase();
    const lower = identifier.toLowerCase();
    if (allowBoolean && ['AND', 'OR', 'NOT', 'TRUE', 'FALSE'].includes(upper)) continue;
    if (ALLOWED_FUNCTIONS.includes(lower) || identifier in CONSTANTS) continue;
    if (!(identifier in variables)) {
      throw new Error(`Unknown ${allowBoolean ? 'constraint' : 'formula'} variable: ${identifier}`);
    }
  }

  const rendered = tokens.map(token => {
    const upper = token.toUpperCase();
    const lower = token.toLowerCase();
    if (allowBoolean && upper === 'AND') return '&&';
    if (allowBoolean && upper === 'OR') return '||';
    if (allowBoolean && upper === 'NOT') return '!';
    if (allowBoolean && upper === 'TRUE') return 'true';
    if (allowBoolean && upper === 'FALSE') return 'false';
    if (token === '^') return '**';
    if (ALLOWED_FUNCTIONS.includes(lower)) return `__fn_${lower}`;
    return token;
  }).join('');

  const functionScope = createExpressionFunctionScope();
  const scope = { ...CONSTANTS, ...variables, ...functionScope };
  const names = Object.keys(scope).filter(name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
  const values = names.map(name => scope[name]);
  try {
    return Function(...names, `"use strict"; return (${rendered});`)(...values);
  } catch (error) {
    throw new Error(`Could not evaluate “${expression}”: ${error.message}`);
  }
}

function createExpressionFunctionScope() {
  const numericValues = (value, fieldName = null) => {
    let values;
    if (fieldName !== null && fieldName !== undefined && fieldName !== '') {
      if (!Array.isArray(value)) throw new Error('A field selector requires a list collection.');
      values = value.map(item => item?.[String(fieldName)]);
    } else if (Array.isArray(value)) {
      values = value.flat(Infinity);
    } else {
      values = [value];
    }
    return values.map(Number).filter(Number.isFinite);
  };
  const flexibleMin = (...args) => {
    const values = args.length === 1 && Array.isArray(args[0]) ? numericValues(args[0]) : args.map(Number);
    return Math.min(...values);
  };
  const flexibleMax = (...args) => {
    const values = args.length === 1 && Array.isArray(args[0]) ? numericValues(args[0]) : args.map(Number);
    return Math.max(...values);
  };
  return {
    __fn_abs: Math.abs,
    __fn_round: Math.round,
    __fn_floor: Math.floor,
    __fn_ceil: Math.ceil,
    __fn_min: flexibleMin,
    __fn_max: flexibleMax,
    __fn_sqrt: Math.sqrt,
    __fn_pow: Math.pow,
    __fn_count: value => Array.isArray(value) || typeof value === 'string' ? value.length : 0,
    __fn_sum: (value, fieldName = null) => numericValues(value, fieldName).reduce((total, item) => total + item, 0),
    __fn_average: (value, fieldName = null) => {
      const values = numericValues(value, fieldName);
      return values.length ? values.reduce((total, item) => total + item, 0) / values.length : NaN;
    },
    __fn_row: (matrix, index) => Array.isArray(matrix?.[Number(index)]) ? [...matrix[Number(index)]] : [],
    __fn_column: (matrix, index) => Array.isArray(matrix) ? matrix.map(rowValue => rowValue?.[Number(index)]) : [],
    __fn_cell: (matrix, rowIndex, columnIndex) => matrix?.[Number(rowIndex)]?.[Number(columnIndex)],
    __fn_contains: (value, expected) => Array.isArray(value) ? value.flat(Infinity).includes(expected) : String(value).includes(String(expected)),
    __fn_field: (list, fieldName) => Array.isArray(list) ? list.map(item => item?.[String(fieldName)]) : [],
    __fn_sort: (value, fieldName = null) => {
      if (!Array.isArray(value)) return [];
      const copy = [...value];
      return copy.sort((left, right) => {
        const a = fieldName === null ? left : left?.[String(fieldName)];
        const b = fieldName === null ? right : right?.[String(fieldName)];
        return typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a).localeCompare(String(b));
      });
    },
    __fn_unique: (value, fieldName = null) => {
      if (!Array.isArray(value)) return [];
      const selected = fieldName === null ? value : value.map(item => item?.[String(fieldName)]);
      return [...new Set(selected)];
    }
  };
}

function tokenizeExpression(expression, allowBoolean) {
  const pattern = allowBoolean
    ? /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|<=|>=|==|!=|&&|\|\||[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/%^<>,!]/g
    : /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/^%,]/g;
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
