const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function logAIRequest({
  userId,
  feature,
  provider,
  inputTokens = 0,
  outputTokens = 0,
  audioSeconds = 0,
  imageCount = 0,
  costUsd = 0,
  success,
  errorMessage = null,
  durationMs = null,
}) {
  try {
    await supabase.from('ai_requests').insert({
      user_id: userId,
      feature,
      provider,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      audio_seconds: audioSeconds,
      image_count: imageCount,
      cost_usd: costUsd,
      success,
      error_message: errorMessage,
      duration_ms: durationMs,
    });
  } catch (err) {
    console.error('[AI logger] Failed to log AI request:', err.message);
  }
}

module.exports = { logAIRequest };
