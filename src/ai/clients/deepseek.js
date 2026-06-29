const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com/v1',
});

async function callDeepSeek({ system, user, responseFormat }) {
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const params = {
    model: 'deepseek-chat',
    messages,
  };
  if (responseFormat) params.response_format = responseFormat;

  let response;
  try {
    response = await client.chat.completions.create(params);
  } catch (err) {
    throw new Error(`DeepSeek error: ${err.message}`);
  }

  const choice = response.choices[0];
  return {
    text: choice.message.content,
    usage: {
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
    },
  };
}

module.exports = { client, callDeepSeek };
