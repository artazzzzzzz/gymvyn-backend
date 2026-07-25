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

// Tool-calling loop for the owner assistant.
// toolExecutor(toolCalls) => { toolResults: [{tool_call_id, result}], earlyReturn: proposedAction|null }
// Returns earlyReturn immediately without appending tool results to the loop,
// so the model never learns which action tool was selected (security).
async function callDeepSeekWithTools({ messages, tools, toolExecutor, maxRounds = 8 }) {
  const client = getClient();
  let current = [...messages];
  let totalInput = 0;
  let totalOutput = 0;

  for (let round = 0; round < maxRounds; round++) {
    let response;
    try {
      response = await client.chat.completions.create({
        model: 'deepseek-chat',
        messages: current,
        tools,
        tool_choice: 'auto',
      });
    } catch (err) {
      throw new Error(`DeepSeek error: ${err.message}`);
    }

    totalInput += response.usage?.prompt_tokens || 0;
    totalOutput += response.usage?.completion_tokens || 0;

    const choice = response.choices[0];
    const msg = choice.message;

    if (!msg.tool_calls?.length) {
      return {
        text: msg.content,
        usage: { inputTokens: totalInput, outputTokens: totalOutput },
        proposedAction: null,
      };
    }

    const { toolResults, earlyReturn } = await toolExecutor(msg.tool_calls);

    if (earlyReturn) {
      return {
        text: null,
        usage: { inputTokens: totalInput, outputTokens: totalOutput },
        proposedAction: earlyReturn,
      };
    }

    // Append assistant turn then tool results
    current.push(msg);
    for (const tr of toolResults) {
      current.push({
        role: 'tool',
        tool_call_id: tr.tool_call_id,
        content: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result),
      });
    }
  }

  return {
    text: 'I reached my analysis limit. Please ask a more specific question.',
    usage: { inputTokens: totalInput, outputTokens: totalOutput },
    proposedAction: null,
  };
}

module.exports = { getClient, callDeepSeek, callDeepSeekWithTools };
