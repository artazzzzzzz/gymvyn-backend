// Rates as of June 2026 (per million tokens or per minute)
const DEEPSEEK_INPUT_PER_M = 0.14;
const DEEPSEEK_OUTPUT_PER_M = 0.28;
const GEMINI_FLASH_LITE_INPUT_PER_M = 0.10;
const GEMINI_FLASH_LITE_OUTPUT_PER_M = 0.40;
const DEEPGRAM_NOVA3_PER_MIN = 0.0043;

function calcDeepSeekCost({ inputTokens, outputTokens }) {
  return (inputTokens / 1_000_000) * DEEPSEEK_INPUT_PER_M
       + (outputTokens / 1_000_000) * DEEPSEEK_OUTPUT_PER_M;
}

function calcGeminiCost({ inputTokens, outputTokens }) {
  return (inputTokens / 1_000_000) * GEMINI_FLASH_LITE_INPUT_PER_M
       + (outputTokens / 1_000_000) * GEMINI_FLASH_LITE_OUTPUT_PER_M;
}

function calcDeepgramCost({ audioSeconds }) {
  return (audioSeconds / 60) * DEEPGRAM_NOVA3_PER_MIN;
}

module.exports = { calcDeepSeekCost, calcGeminiCost, calcDeepgramCost };
