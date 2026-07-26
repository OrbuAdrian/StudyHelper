import assert from 'node:assert/strict';
import { callGemini } from '../assets/js/services/gemini-client.js';

let capturedBody = null;
globalThis.fetch = async (_url, options) => {
  capturedBody = JSON.parse(options.body);
  return {
    ok: true,
    async json() {
      return {
        candidates: [{
          finishReason: 'STOP',
          content: { parts: [{ text: '{"title":"Review","flashcards":[]}' }] }
        }]
      };
    }
  };
};

const schema = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title']
};
const text = await callGemini({
  prompt: 'Return JSON.',
  apiKey: 'test-key',
  model: 'gemini-2.5-flash',
  jsonMode: true,
  responseSchema: schema,
  maxOutputTokens: 12000,
  temperature: 0.15
});
assert.match(text, /Review/);
assert.equal(capturedBody.generationConfig.responseMimeType, 'application/json');
assert.deepEqual(capturedBody.generationConfig.responseSchema, schema);
assert.equal(capturedBody.generationConfig.maxOutputTokens, 12000);
assert.equal(capturedBody.generationConfig.temperature, 0.15);

globalThis.fetch = async () => ({
  ok: true,
  async json() {
    return {
      candidates: [{
        finishReason: 'MAX_TOKENS',
        content: { parts: [{ text: '{"incomplete":' }] }
      }]
    };
  }
});
await assert.rejects(() => callGemini({
  prompt: 'Return JSON.',
  apiKey: 'test-key',
  model: 'gemini-2.5-flash',
  jsonMode: true
}), /output-token limit/i);

console.log('Gemini client structured-output tests passed.');

let fallbackCalls = 0;
const fallbackBodies = [];
globalThis.fetch = async (_url, options) => {
  fallbackCalls += 1;
  fallbackBodies.push(JSON.parse(options.body));
  if (fallbackCalls === 1) {
    return {
      ok: false,
      status: 400,
      async json() {
        return { error: { message: 'Invalid JSON payload received. Unknown name "additionalProperties" at generation_config.response_schema.' } };
      }
    };
  }
  return {
    ok: true,
    async json() {
      return {
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"flashcards":[]}' }] } }]
      };
    }
  };
};
const fallbackText = await callGemini({
  prompt: 'Return JSON.',
  apiKey: 'test-key',
  model: 'gemini-2.5-flash',
  jsonMode: true,
  responseSchema: schema,
  schemaFallback: true
});
assert.match(fallbackText, /flashcards/);
assert.equal(fallbackCalls, 2);
assert.deepEqual(fallbackBodies[0].generationConfig.responseSchema, schema);
assert.equal(Object.hasOwn(fallbackBodies[1].generationConfig, 'responseSchema'), false);

let cachedFallbackBody = null;
globalThis.fetch = async (_url, options) => {
  cachedFallbackBody = JSON.parse(options.body);
  return {
    ok: true,
    async json() {
      return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"flashcards":[]}' }] } }] };
    }
  };
};
await callGemini({
  prompt: 'Return JSON again.',
  apiKey: 'test-key',
  model: 'gemini-2.5-flash',
  jsonMode: true,
  responseSchema: schema,
  schemaFallback: true
});
assert.equal(Object.hasOwn(cachedFallbackBody.generationConfig, 'responseSchema'), false);

let genericFallbackCalls = 0;
const genericFallbackBodies = [];
globalThis.fetch = async (_url, options) => {
  genericFallbackCalls += 1;
  genericFallbackBodies.push(JSON.parse(options.body));
  if (genericFallbackCalls === 1) {
    return {
      ok: false,
      status: 400,
      async json() {
        return { error: { status: 'INVALID_ARGUMENT', message: 'Request contains an invalid argument.' } };
      }
    };
  }
  return {
    ok: true,
    status: 200,
    async json() {
      return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"flashcards":[]}' }] } }] };
    }
  };
};
const genericFallback = await callGemini({
  prompt: 'Return JSON.',
  apiKey: 'test-key',
  model: 'gemini-generic-schema-test',
  jsonMode: true,
  responseSchema: schema,
  schemaFallback: true,
  returnDiagnostics: true
});
assert.equal(genericFallbackCalls, 2);
assert.equal(Object.hasOwn(genericFallbackBodies[0].generationConfig, 'responseSchema'), true);
assert.equal(Object.hasOwn(genericFallbackBodies[1].generationConfig, 'responseSchema'), false);
assert.equal(genericFallback.diagnostics.attempts[0].apiStatus, 'INVALID_ARGUMENT');
assert.equal(genericFallback.diagnostics.attempts[1].mode, 'json-mime');

let plainFallbackCalls = 0;
const plainFallbackBodies = [];
globalThis.fetch = async (_url, options) => {
  plainFallbackCalls += 1;
  plainFallbackBodies.push(JSON.parse(options.body));
  if (plainFallbackCalls < 3) {
    return {
      ok: false,
      status: 400,
      async json() {
        return { error: { status: 'INVALID_ARGUMENT', message: 'Request contains an invalid argument.' } };
      }
    };
  }
  return {
    ok: true,
    status: 200,
    async json() {
      return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"flashcards":[]}' }] } }] };
    }
  };
};
const plainFallback = await callGemini({
  prompt: 'Return JSON.',
  apiKey: 'test-key',
  model: 'gemini-generic-json-test',
  jsonMode: true,
  responseSchema: schema,
  schemaFallback: true,
  jsonCompatibilityFallback: true,
  returnDiagnostics: true
});
assert.equal(plainFallbackCalls, 3);
assert.equal(Object.hasOwn(plainFallbackBodies[2].generationConfig, 'responseMimeType'), false);
assert.deepEqual(plainFallback.diagnostics.attempts.map(item => item.mode), ['json-schema', 'json-mime', 'plain-text']);
