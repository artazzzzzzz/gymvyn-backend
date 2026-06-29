const OpenAI = require('openai');

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY not set');
    _client = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' });
  }
  return _client;
}

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
    response = await getClient().chat.completions.create(params);
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

module.exports = { getClient, callDeepSeek };
