export const clone = value => JSON.parse(JSON.stringify(value));

export function inferTitle(text) {
  const line = String(text || '')
    .split(/\n/)
    .map(value => value.trim())
    .find(Boolean) || 'Untitled topic';
  return truncate(line.replace(/^#+\s*/, ''), 70);
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[“”‘’]/g, "'")
    .replace(/[^a-z0-9.+#_\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function humanizeType(type) {
  const labels = {
    multiple_choice: 'Multiple choice',
    single_answer: 'Single answer',
    valid_statement: 'Valid statement',
    semantic: 'Semantic answer',
    semantic_explanation: 'Semantic explanation',
    definition: 'Definition',
    comparison: 'Comparison',
    reasoning: 'Reasoning',
    phrase_completion: 'Phrase completion',
    phrase: 'Phrase completion'
  };

  return labels[type] || String(type || 'Exercise')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

export function formatAnswer(answer) {
  if (answer == null) return '';
  if (Array.isArray(answer)) return answer.join(', ');
  if (typeof answer === 'object') return JSON.stringify(answer);
  return String(answer);
}

export function decimalCount(number) {
  const text = String(number);
  if (/e-/i.test(text)) return Number(text.split(/e-/i)[1]);
  return (text.split('.')[1] || '').length;
}

export function randomInt(min, max) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `sf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function slugify(value) {
  return normalizeText(value || 'study-forge')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'study-forge';
}

export function truncate(value, length = 90) {
  const text = String(value || '');
  return text.length > length
    ? `${text.slice(0, Math.max(0, length - 1)).trim()}…`
    : text;
}

export function formatDate(value) {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';

  const locale = globalThis.document?.documentElement?.lang === 'ro' ? 'ro-RO' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
  }).format(date);
}

export function formatBytes(bytes) {
  if (!bytes) return '0 KB';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / (1024 ** index);
  return `${value.toFixed(index === 0 || value >= 10 ? 0 : 1)} ${units[index]}`;
}

export function stripMarkdown(value) {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, block => block.replace(/```[^\n]*\n?|```/g, ''))
    .replace(/[#>*_`~-]/g, '')
    .replace(/\[(.*?)\]\([^)]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function shuffleArray(values) {
  const array = [...values];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index);
    [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
  }
  return array;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  })[character]);
}

export const escapeAttr = escapeHtml;

export function cleanModelText(value) {
  return String(value || '').replace(/^\uFEFF/, '').trim();
}

export function parseJsonResponse(raw) {
  const cleaned = cleanModelText(raw)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('The AI response was not valid JSON. Please regenerate it.');
  }
}

export function friendlyApiError(error) {
  const message = String(error?.message || error || 'Unknown error');
  if (/API key not valid|invalid api key/i.test(message)) {
    return 'The Gemini API key is invalid. Check it in Settings.';
  }
  if (/quota|resource_exhausted|429/i.test(message)) {
    return 'The Gemini quota or rate limit was reached. Try again after the quota resets.';
  }
  if (/fetch|network|failed to fetch/i.test(message)) {
    return 'The browser could not reach Gemini. Check your internet connection and browser network permissions.';
  }
  if (/model.*not found|404/i.test(message)) {
    return 'The selected Gemini model is unavailable for this key. Choose another model in Settings.';
  }
  if (/blocked|safety/i.test(message)) {
    return 'Gemini blocked this request. Adjust the source or generation instructions.';
  }
  return message;
}
