const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function callGeminiVision({ images, prompt, responseSchema }) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
      responseMimeType: 'application/json',
      ...(responseSchema ? { responseSchema } : {}),
    },
  });

  const imageParts = images.map((base64, i) => ({
    inlineData: {
      data: base64,
      mimeType: 'image/jpeg',
    },
  }));

  let result;
  try {
    result = await model.generateContent([...imageParts, prompt]);
  } catch (err) {
    throw new Error(`Gemini error: ${err.message}`);
  }

  const response = result.response;
  const text = response.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Gemini error: response was not valid JSON — ${text.slice(0, 200)}`);
  }

  const usage = response.usageMetadata || {};
  return {
    json,
    usage: {
      inputTokens: usage.promptTokenCount || 0,
      outputTokens: usage.candidatesTokenCount || 0,
    },
  };
}

module.exports = { genAI, callGeminiVision };
