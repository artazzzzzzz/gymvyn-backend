const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { auth: baseAuth } = require('../../middleware/auth');

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Wraps the canonical auth middleware to additionally attach the caller's
// role, which downstream handlers here use for post-type gating.
async function auth(req, res, next) {
  return baseAuth(req, res, async () => {
    const { data: userRow } = await supabase
      .from('users')
      .select('role')
      .eq('id', req.user.id)
      .maybeSingle();
    req.user.role = userRow?.role || 'consumer';

    next();
  });
}

// Verifies the calling user is actually a member of :gymId before any read/write.
// Must run after the local `auth` wrapper (which attaches req.user.role).
async function requireGymMembership(req, res, next) {
  const gymId = req.params.gymId;
  if (!gymId) return res.status(400).json({ error: 'gymId param required' });

  const { id: userId, role } = req.user;
  let allowed = false;

  try {
    if (role === 'gym_owner') {
      const { data } = await supabase
        .from('gyms')
        .select('id')
        .eq('id', gymId)
        .eq('owner_id', userId)
        .maybeSingle();
      allowed = !!data;
    } else if (role === 'staff') {
      const { data } = await supabase
        .from('gym_staff')
        .select('id')
        .eq('gym_id', gymId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      allowed = !!data;
    } else if (role === 'trainer') {
      const { data } = await supabase
        .from('trainer_profiles')
        .select('id')
        .eq('user_id', userId)
        .eq('gym_id', gymId)
        .maybeSingle();
      allowed = !!data;
    } else {
      // consumer (default)
      const { data } = await supabase
        .from('gym_memberships')
        .select('id')
        .eq('gym_id', gymId)
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
      allowed = !!data;
    }
  } catch (err) {
    console.error('requireGymMembership error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  if (!allowed) return res.status(403).json({ error: 'Not a member of this gym' });
  next();
}

const VALID_POST_TYPES = ['announcement', 'achievement', 'tip', 'general'];

function allowedPostTypes(role) {
  switch (role) {
    case 'gym_owner': return ['announcement', 'general'];
    case 'staff':     return ['announcement', 'general'];
    case 'trainer':   return ['tip', 'general'];
    default:          return ['general'];
  }
}

// ── GET /:gymId/posts ─────────────────────────────────────────────────────────

router.get('/:gymId/posts', auth, requireGymMembership, async (req, res) => {
  try {
    const { gymId } = req.params;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const from  = (page - 1) * limit;
    const to    = from + limit - 1;

    const { data: posts, error, count } = await supabase
      .from('gym_feed_posts')
      .select('*, users!gym_feed_posts_author_id_fkey(full_name, role)', { count: 'exact' })
      .eq('gym_id', gymId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return res.status(500).json({ error: error.message });

    const postIds = (posts || []).map(p => p.id);

    // Batch like counts
    const { data: likeRows } = await supabase
      .from('gym_feed_likes')
      .select('post_id')
      .in('post_id', postIds);

    // Check which posts current user liked
    const { data: userLikeRows } = await supabase
      .from('gym_feed_likes')
      .select('post_id')
      .in('post_id', postIds)
      .eq('user_id', req.user.id);

    const likeCountMap = {};
    for (const row of (likeRows || [])) {
      likeCountMap[row.post_id] = (likeCountMap[row.post_id] || 0) + 1;
    }
    const userLikedSet = new Set((userLikeRows || []).map(r => r.post_id));

    // Batch comment counts
    const { data: commentRows } = await supabase
      .from('gym_feed_comments')
      .select('post_id')
      .in('post_id', postIds);

    const commentCountMap = {};
    for (const row of (commentRows || [])) {
      commentCountMap[row.post_id] = (commentCountMap[row.post_id] || 0) + 1;
    }

    const enriched = (posts || []).map(p => ({
      id:               p.id,
      gym_id:           p.gym_id,
      author_id:        p.author_id,
      author_name:      p.users?.full_name || 'Unknown',
      author_role:      p.users?.role || 'consumer',
      post_type:        p.post_type,
      title:            p.title,
      content:          p.content,
      image_url:        p.image_url,
      is_pinned:        p.is_pinned,
      is_auto_generated: p.is_auto_generated,
      created_at:       p.created_at,
      like_count:       likeCountMap[p.id] || 0,
      comment_count:    commentCountMap[p.id] || 0,
      user_has_liked:   userLikedSet.has(p.id),
    }));

    res.json({ posts: enriched, total: count || 0, page, limit });
  } catch (err) {
    console.error('GET /:gymId/posts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:gymId/posts ────────────────────────────────────────────────────────

router.post('/:gymId/posts', auth, requireGymMembership, async (req, res) => {
  try {
    const { gymId } = req.params;
    let { post_type, title, content, image_url } = req.body;

    if (!content) return res.status(400).json({ error: 'content is required' });
    if (!VALID_POST_TYPES.includes(post_type)) {
      return res.status(400).json({ error: `post_type must be one of: ${VALID_POST_TYPES.join(', ')}` });
    }

    const role = req.user.role;
    const allowed = allowedPostTypes(role);
    if (!allowed.includes(post_type)) {
      return res.status(403).json({ error: `Your role (${role}) cannot create post_type '${post_type}'` });
    }

    // Consumers cannot attach images
    if (role === 'consumer') image_url = null;

    const { data: post, error } = await supabase
      .from('gym_feed_posts')
      .insert({
        gym_id:           gymId,
        author_id:        req.user.id,
        post_type,
        title:            title || null,
        content,
        image_url:        image_url || null,
        is_pinned:        false,
        is_auto_generated: false,
      })
      .select('*, users!gym_feed_posts_author_id_fkey(full_name, role)')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({
      ...post,
      author_name: post.users?.full_name || 'Unknown',
      author_role: post.users?.role || role,
      like_count:  0,
      comment_count: 0,
      user_has_liked: false,
    });
  } catch (err) {
    console.error('POST /:gymId/posts error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:gymId/posts/:postId ──────────────────────────────────────────────

router.delete('/:gymId/posts/:postId', auth, async (req, res) => {
  try {
    const { gymId, postId } = req.params;
    const role = req.user.id;

    const { data: post, error: fetchErr } = await supabase
      .from('gym_feed_posts')
      .select('id, author_id, gym_id')
      .eq('id', postId)
      .eq('gym_id', gymId)
      .maybeSingle();

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const isOwnPost = post.author_id === req.user.id;
    let canDelete = isOwnPost;

    if (!canDelete && req.user.role === 'gym_owner') {
      const { data: gym } = await supabase
        .from('gyms').select('id').eq('id', gymId).eq('owner_id', req.user.id).maybeSingle();
      canDelete = !!gym;
    }

    if (!canDelete && req.user.role === 'staff') {
      const { data: staffRow } = await supabase
        .from('gym_staff').select('id').eq('gym_id', gymId).eq('user_id', req.user.id).eq('is_active', true).maybeSingle();
      canDelete = !!staffRow;
    }

    if (!canDelete) return res.status(403).json({ error: 'Not authorized to delete this post' });

    const { error: deleteErr } = await supabase
      .from('gym_feed_posts').delete().eq('id', postId);

    if (deleteErr) return res.status(500).json({ error: deleteErr.message });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /:gymId/posts/:postId error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /:gymId/posts/:postId/pin ──────────────────────────────────────────

router.patch('/:gymId/posts/:postId/pin', auth, async (req, res) => {
  try {
    const { gymId, postId } = req.params;

    let canPin = false;

    if (req.user.role === 'gym_owner') {
      const { data: gym } = await supabase
        .from('gyms').select('id').eq('id', gymId).eq('owner_id', req.user.id).maybeSingle();
      canPin = !!gym;
    }

    if (!canPin && req.user.role === 'staff') {
      const { data: staffRow } = await supabase
        .from('gym_staff').select('id').eq('gym_id', gymId).eq('user_id', req.user.id).eq('is_active', true).maybeSingle();
      canPin = !!staffRow;
    }

    if (!canPin) return res.status(403).json({ error: 'Only gym owners or staff can pin posts' });

    const { data: existing, error: fetchErr } = await supabase
      .from('gym_feed_posts').select('id, is_pinned').eq('id', postId).eq('gym_id', gymId).maybeSingle();

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!existing) return res.status(404).json({ error: 'Post not found' });

    const { data: updated, error: updateErr } = await supabase
      .from('gym_feed_posts')
      .update({ is_pinned: !existing.is_pinned })
      .eq('id', postId)
      .select()
      .single();

    if (updateErr) return res.status(500).json({ error: updateErr.message });
    res.json(updated);
  } catch (err) {
    console.error('PATCH /:gymId/posts/:postId/pin error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:gymId/posts/:postId/like ──────────────────────────────────────────

router.post('/:gymId/posts/:postId/like', auth, requireGymMembership, async (req, res) => {
  try {
    const { postId } = req.params;

    const { data: existing } = await supabase
      .from('gym_feed_likes')
      .select('id')
      .eq('post_id', postId)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (existing) {
      await supabase.from('gym_feed_likes').delete().eq('id', existing.id);
    } else {
      await supabase.from('gym_feed_likes').insert({ post_id: postId, user_id: req.user.id });
    }

    const { count } = await supabase
      .from('gym_feed_likes')
      .select('id', { count: 'exact', head: true })
      .eq('post_id', postId);

    res.json({ liked: !existing, like_count: count || 0 });
  } catch (err) {
    console.error('POST /:gymId/posts/:postId/like error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:gymId/posts/:postId/comments ───────────────────────────────────────

router.get('/:gymId/posts/:postId/comments', auth, requireGymMembership, async (req, res) => {
  try {
    const { postId } = req.params;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 30);
    const from  = (page - 1) * limit;
    const to    = from + limit - 1;

    const { data: comments, error, count } = await supabase
      .from('gym_feed_comments')
      .select('*, users!gym_feed_comments_author_id_fkey(full_name, role)', { count: 'exact' })
      .eq('post_id', postId)
      .order('created_at', { ascending: true })
      .range(from, to);

    if (error) return res.status(500).json({ error: error.message });

    const enriched = (comments || []).map(c => ({
      id:          c.id,
      post_id:     c.post_id,
      author_id:   c.author_id,
      author_name: c.users?.full_name || 'Unknown',
      author_role: c.users?.role || 'consumer',
      content:     c.content,
      created_at:  c.created_at,
    }));

    res.json({ comments: enriched, total: count || 0, page, limit });
  } catch (err) {
    console.error('GET /:gymId/posts/:postId/comments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /:gymId/posts/:postId/comments ──────────────────────────────────────

router.post('/:gymId/posts/:postId/comments', auth, requireGymMembership, async (req, res) => {
  try {
    const { gymId, postId } = req.params;
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required' });

    // Verify post belongs to this gym
    const { data: post } = await supabase
      .from('gym_feed_posts').select('id').eq('id', postId).eq('gym_id', gymId).maybeSingle();
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const { data: comment, error } = await supabase
      .from('gym_feed_comments')
      .insert({ post_id: postId, author_id: req.user.id, content })
      .select('*, users!gym_feed_comments_author_id_fkey(full_name, role)')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    res.status(201).json({
      id:          comment.id,
      post_id:     comment.post_id,
      author_id:   comment.author_id,
      author_name: comment.users?.full_name || 'Unknown',
      author_role: comment.users?.role || 'consumer',
      content:     comment.content,
      created_at:  comment.created_at,
    });
  } catch (err) {
    console.error('POST /:gymId/posts/:postId/comments error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /:gymId/posts/:postId/comments/:commentId ─────────────────────────

router.delete('/:gymId/posts/:postId/comments/:commentId', auth, async (req, res) => {
  try {
    const { gymId, postId, commentId } = req.params;

    const { data: comment, error: fetchErr } = await supabase
      .from('gym_feed_comments')
      .select('id, author_id')
      .eq('id', commentId)
      .eq('post_id', postId)
      .maybeSingle();

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });
    if (!comment) return res.status(404).json({ error: 'Comment not found' });

    const isOwn = comment.author_id === req.user.id;
    let canDelete = isOwn;

    if (!canDelete && req.user.role === 'gym_owner') {
      const { data: gym } = await supabase
        .from('gyms').select('id').eq('id', gymId).eq('owner_id', req.user.id).maybeSingle();
      canDelete = !!gym;
    }

    if (!canDelete && req.user.role === 'staff') {
      const { data: staffRow } = await supabase
        .from('gym_staff').select('id').eq('gym_id', gymId).eq('user_id', req.user.id).eq('is_active', true).maybeSingle();
      canDelete = !!staffRow;
    }

    if (!canDelete) return res.status(403).json({ error: 'Not authorized to delete this comment' });

    const { error: deleteErr } = await supabase
      .from('gym_feed_comments').delete().eq('id', commentId);

    if (deleteErr) return res.status(500).json({ error: deleteErr.message });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /:gymId/posts/:postId/comments/:commentId error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
