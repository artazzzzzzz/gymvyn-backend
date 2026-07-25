const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
const { callDeepSeek } = require('../ai/clients/deepseek');

function getSupabase() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Summarise old turns and delete them — mirrors the Claude compact feature.
// Runs nightly at 02:30 UTC. Keeps assistant_action_log indefinitely (audit).
async function runAssistantCompaction() {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  console.log('[Assistant Cron] Compaction started at', new Date().toISOString());

  // All conversations that have at least one old non-compacted message
  const { data: convs, error: cErr } = await supabase
    .from('assistant_conversations')
    .select('id, context_summary');

  if (cErr) { console.error('[Assistant Cron] Failed to list convs:', cErr.message); return; }

  let summarised = 0;

  for (const conv of convs || []) {
    const { data: oldMsgs, error: mErr } = await supabase
      .from('assistant_messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', conv.id)
      .eq('is_compacted', false)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true });

    if (mErr || !oldMsgs?.length) continue;

    // Summarise with DeepSeek
    const transcript = oldMsgs
      .map(m => `${m.role === 'user' ? 'Owner' : 'Assistant'}: ${m.content}`)
      .join('\n');

    let summary = '';
    try {
      const { text } = await callDeepSeek({
        system:
          'Summarise a gym-owner assistant conversation into 2–4 sentences. ' +
          'Cover: key data the owner reviewed, decisions made, actions confirmed. Be concise.',
        user: `Conversation to summarise:\n\n${transcript}`,
      });
      summary = text?.trim() || '';
    } catch (err) {
      console.error('[Assistant Cron] DeepSeek summarise error:', err.message);
      continue;
    }

    if (!summary) continue;

    const range =
      `${new Date(oldMsgs[0].created_at).toDateString()} – ` +
      `${new Date(oldMsgs[oldMsgs.length - 1].created_at).toDateString()}`;
    const newSummary = conv.context_summary
      ? `${conv.context_summary}\n\n[${range}]: ${summary}`
      : `[${range}]: ${summary}`;

    // Persist summary
    await supabase
      .from('assistant_conversations')
      .update({ context_summary: newSummary })
      .eq('id', conv.id);

    // Delete the now-summarised messages
    const ids = oldMsgs.map(m => m.id);
    await supabase.from('assistant_messages').delete().in('id', ids);

    summarised++;
  }

  console.log(`[Assistant Cron] Compaction done — ${summarised} conversation(s) summarised`);
}

function initAssistantCrons() {
  // Nightly compaction at 02:30 UTC
  cron.schedule('30 2 * * *', async () => {
    try { await runAssistantCompaction(); }
    catch (err) { console.error('[Assistant Cron] Unhandled error:', err.message); }
  }, { timezone: 'UTC' });
}

module.exports = { initAssistantCrons };
