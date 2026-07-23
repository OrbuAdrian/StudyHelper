export async function callGemini({ prompt, apiKey, model, jsonMode = false }) {
  if (!apiKey) throw new Error('A Gemini API key is required.');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const generationConfig = {
    temperature: jsonMode ? 0.35 : 0.55,
    topP: 0.9,
    maxOutputTokens: jsonMode ? 3000 : 6500
  };

  if (jsonMode) generationConfig.responseMimeType = 'application/json';

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
  if (!response.ok) {
    const message = payload?.error?.message
      || `Gemini request failed with status ${response.status}.`;
    throw new Error(message);
  }

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('')
    .trim();

  if (!text) {
    const reason = payload?.promptFeedback?.blockReason;
    throw new Error(
      reason
        ? `The request was blocked: ${reason}.`
        : 'Gemini returned an empty response.'
    );
  }

  return text;
}
