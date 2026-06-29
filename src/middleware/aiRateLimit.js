const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const DAILY_LIMIT = 50;

async function aiRateLimit(req, res, next) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('ai_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', since)
    .gt('cost_usd', 0); // cache hits (cost_usd=0) don't count against daily limit

  if (error) {
    console.error('[aiRateLimit] count error:', error.message);
    return next();
  }

  if (count >= DAILY_LIMIT) {
    return res.status(429).json({
      error: 'AI_DAILY_LIMIT_REACHED',
      message: "You've reached today's AI usage limit. Try again tomorrow.",
      limit: DAILY_LIMIT,
    });
  }

  next();
}

module.exports = { aiRateLimit };
