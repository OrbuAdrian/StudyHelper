import { normalizeText } from '../core/utils.js';

export function compareNumericAnswers(a, b, tolerance = 0.0001, toleranceType = 'relative') {
  const clean = value => String(value)
    .trim()
    .replace(/,/g, '')
    .replace(/\s*(milliseconds?|ms|seconds?|sec|s|bytes?|bits?|bps|m\/s|kg|n|j|w)$/i, '');

  const aNumber = Number(clean(a));
  const bNumber = Number(clean(b));

  if (!Number.isFinite(aNumber) || !Number.isFinite(bNumber)) return null;

  const difference = Math.abs(aNumber - bNumber);
  if (toleranceType === 'absolute') return difference <= tolerance;
  if (toleranceType === 'percentage') {
    return difference <= (Math.abs(bNumber) * tolerance / 100);
  }
  return difference <= tolerance * Math.max(1, Math.abs(bNumber));
}

export function looksLikeExpression(value) {
  return /^[\dA-Za-z_\s()+\-*/^.=]+$/.test(value)
    && /[+\-*/^()]/.test(value);
}

export function areExpressionsEquivalent(a, b) {
  if (!globalThis.math) return false;

  try {
    const normalizeExpression = value => value.includes('=')
      ? value.split('=').slice(1).join('=')
      : value;

    const left = normalizeExpression(a);
    const right = normalizeExpression(b);

    if (globalThis.math.simplify(`(${left}) - (${right})`).toString() === '0') {
      return true;
    }

    const symbols = new Set();
    [globalThis.math.parse(left), globalThis.math.parse(right)].forEach(tree => {
      tree.traverse(node => {
        if (node.isSymbolNode && !['e', 'pi'].includes(node.name)) {
          symbols.add(node.name);
        }
      });
    });

    const testValues = [1.2, 2.3, 4.7, 7.1];
    return testValues.every((base, index) => {
      const scope = Object.fromEntries(
        [...symbols].map((name, variableIndex) => [
          name,
          base + index + variableIndex * 0.7
        ])
      );

      const difference = Number(
        globalThis.math.evaluate(`(${left}) - (${right})`, scope)
      );

      return Number.isFinite(difference) && Math.abs(difference) < 1e-8;
    });
  } catch {
    return false;
  }
}

export function checkKeywords(answer, keywords) {
  const normalized = normalizeText(answer);
  const missing = keywords.filter(
    keyword => !normalized.includes(normalizeText(keyword))
  );

  return {
    passed: missing.length === 0,
    missing
  };
}
