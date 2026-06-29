const { createClient } = require('@supabase/supabase-js');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

async function getCachedVisionResult(imageHash) {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('food_vision_cache')
      .select('result_json')
      .eq('image_hash', imageHash)
      .maybeSingle();

    if (error || !data) return null;

    // Update hit stats fire-and-forget
    supabase
      .from('food_vision_cache')
      .update({ hit_count: data.hit_count + 1, last_hit_at: new Date().toISOString() })
      .eq('image_hash', imageHash)
      .then(() => {})
      .catch(() => {});

    return data.result_json;
  } catch {
    return null;
  }
}

async function setCachedVisionResult(imageHash, resultJson) {
  try {
    const supabase = getSupabase();
    await supabase
      .from('food_vision_cache')
      .insert({ image_hash: imageHash, result_json: resultJson })
      .throwOnError();
  } catch (err) {
    // ON CONFLICT we just ignore — duplicate key is fine
    if (!err.message?.includes('duplicate') && !err.message?.includes('23505')) {
      console.error('[visionCache] setCachedVisionResult failed:', err.message);
    }
  }
}

module.exports = { getCachedVisionResult, setCachedVisionResult };
