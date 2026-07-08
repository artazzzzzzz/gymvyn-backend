const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function postAchievement({ gymId, userId, content }) {
  // Respect share_achievements preference
  const { data: user } = await supabase
    .from('users')
    .select('share_achievements')
    .eq('id', userId)
    .maybeSingle();

  if (!user?.share_achievements) return;

  // Verify user is a CURRENT (active) member of this gym — a stale row from
  // a gym they've since unlinked from must not authorize a feed post there.
  const { data: membership } = await supabase
    .from('gym_memberships')
    .select('id')
    .eq('gym_id', gymId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle();

  if (!membership) return;

  await supabase.from('gym_feed_posts').insert({
    gym_id:           gymId,
    author_id:        userId,
    post_type:        'achievement',
    content,
    is_pinned:        false,
    is_auto_generated: true,
  });
}

module.exports = { postAchievement };
