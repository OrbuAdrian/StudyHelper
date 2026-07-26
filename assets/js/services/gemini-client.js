const schemaUnsupportedModels = new Set();
const jsonMimeUnsupportedModels = new Set();

function isApiCredentialOrPermissionError(message = '') {
  return /api key|permission|permission_denied|billing|quota|resource_exhausted|leaked key/i.test(String(message));
}

function isInvalidArgumentResponse(response, payload) {
  const apiStatus = String(payload?.error?.status || '').toUpperCase();
  const message = String(payload?.error?.message || '');
  return response?.status === 400
    && (apiStatus === 'INVALID_ARGUMENT' || /invalid argument|invalid json payload|malformed request/i.test(message));
}

function shouldFallbackFromSchema(response, payload) {
  const message = String(payload?.error?.message || '');
  if (isApiCredentialOrPermissionError(message)) return false;
  return isInvalidArgumentResponse(response, payload)
    || /response[_ ]?schema|responseSchema|additionalProperties|propertyOrdering|unknown name.*schema|cannot find field/i.test(message);
}

function shouldFallbackFromJsonMime(response, payload) {
  const message = String(payload?.error?.message || '');
  if (isApiCredentialOrPermissionError(message)) return false;
  return isInvalidArgumentResponse(response, payload)
    || /responseMimeType|response_mime_type|application\/json/i.test(message);
}

async function postGemini(endpoint, apiKey, prompt, generationConfig) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig
    })
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function describeAttempt(mode, response, payload, generationConfig) {
  return {
    mode,
    ok: Boolean(response?.ok),
    httpStatus: Number(response?.status || 0),
    apiStatus: String(payload?.error?.status || ''),
    message: String(payload?.error?.message || ''),
    request: {
      responseMimeType: generationConfig.responseMimeType || null,
      responseSchemaIncluded: Boolean(generationConfig.responseSchema),
      maxOutputTokens: generationConfig.maxOutputTokens,
      temperature: generationConfig.temperature,
      topP: generationConfig.topP
    }
  };
}

function createGeminiError(message, diagnostics, extra = {}) {
  const error = new Error(message);
  error.name = 'GeminiRequestError';
  error.geminiDiagnostics = {
    ...diagnostics,
    ...extra
  };
  const finalAttempt = diagnostics.attempts?.[diagnostics.attempts.length - 1];
  error.status = finalAttempt?.httpStatus || 0;
  error.apiStatus = finalAttempt?.apiStatus || '';
  return error;
}

export async function callGemini({
  prompt,
  apiKey,
  model,
  jsonMode = false,
  maxOutputTokens = null,
  responseSchema = null,
  temperature = null,
  schemaFallback = false,
  jsonCompatibilityFallback = false,
  returnDiagnostics = false
}) {
  if (!apiKey) throw new Error('A Gemini API key is required.');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const generationConfig = {
    temperature: Number.isFinite(Number(temperature))
      ? Number(temperature)
      : (jsonMode ? 0.2 : 0.55),
    topP: 0.9,
    maxOutputTokens: Number(maxOutputTokens) > 0 ? Number(maxOutputTokens) : (jsonMode ? 3000 : 6500)
  };

  if (jsonMode && !jsonMimeUnsupportedModels.has(model)) {
    generationConfig.responseMimeType = 'application/json';
    if (responseSchema && typeof responseSchema === 'object' && !schemaUnsupportedModels.has(model)) {
      generationConfig.responseSchema = responseSchema;
    }
  }

  const diagnostics = {
    model,
    endpointVersion: 'v1beta',
    promptCharacters: String(prompt || '').length,
    attempts: []
  };

  let currentConfig = { ...generationConfig };
  let mode = currentConfig.responseSchema
    ? 'json-schema'
    : currentConfig.responseMimeType
      ? 'json-mime'
      : 'plain-text';

  let { response, payload } = await postGemini(endpoint, apiKey, prompt, currentConfig);
  diagnostics.attempts.push(describeAttempt(mode, response, payload, currentConfig));

  if (!response.ok && currentConfig.responseSchema && schemaFallback && shouldFallbackFromSchema(response, payload)) {
    schemaUnsupportedModels.add(model);
    currentConfig = { ...currentConfig };
    delete currentConfig.responseSchema;
    mode = currentConfig.responseMimeType ? 'json-mime' : 'plain-text';
    ({ response, payload } = await postGemini(endpoint, apiKey, prompt, currentConfig));
    diagnostics.attempts.push(describeAttempt(mode, response, payload, currentConfig));
  }

  if (!response.ok && currentConfig.responseMimeType && jsonCompatibilityFallback && shouldFallbackFromJsonMime(response, payload)) {
    jsonMimeUnsupportedModels.add(model);
    currentConfig = { ...currentConfig };
    delete currentConfig.responseMimeType;
    delete currentConfig.responseSchema;
    mode = 'plain-text';
    ({ response, payload } = await postGemini(endpoint, apiKey, prompt, currentConfig));
    diagnostics.attempts.push(describeAttempt(mode, response, payload, currentConfig));
  }

  if (!response.ok) {
    const message = payload?.error?.message
      || `Gemini request failed with status ${response.status}.`;
    throw createGeminiError(message, diagnostics, {
      apiErrorPayload: payload?.error || null
    });
  }

  const candidate = payload?.candidates?.[0];
  const finishReason = String(candidate?.finishReason || '').toUpperCase();
  const text = candidate?.content?.parts
    ?.map(part => part.text || '')
    .join('')
    .trim();

  diagnostics.finishReason = finishReason || 'UNKNOWN';
  diagnostics.responseCharacters = String(text || '').length;

  if (finishReason === 'MAX_TOKENS') {
    throw createGeminiError(
      'Gemini stopped because the structured response reached the output-token limit. Study Forge will split the source into smaller batches and retry.',
      diagnostics,
      { responseText: String(text || '') }
    );
  }

  if (!text) {
    const reason = payload?.promptFeedback?.blockReason;
    throw createGeminiError(
      reason
        ? `The request was blocked: ${reason}.`
        : 'Gemini returned an empty response.',
      diagnostics,
      {
        promptFeedback: payload?.promptFeedback || null,
        candidate: candidate || null
      }
    );
  }

  if (returnDiagnostics) return { text, diagnostics };
  return text;
}
