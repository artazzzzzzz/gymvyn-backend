-- READ-ONLY review query. Do not turn this into an UPDATE without an approved
-- backfill migration. It exposes IDs/timestamps only; do not log message text.
WITH latest AS (
  SELECT DISTINCT ON (conversation_id) conversation_id, id AS message_id, created_at,
         left(content, 60) AS expected_preview
  FROM public.messages
  ORDER BY conversation_id, created_at DESC NULLS LAST, id DESC
)
SELECT c.id AS conversation_id, l.message_id AS latest_message_id, l.created_at AS expected_last_message_at,
       (c.last_message_preview IS DISTINCT FROM l.expected_preview OR c.last_message_at IS DISTINCT FROM l.created_at) AS needs_reconciliation
FROM public.conversations c LEFT JOIN latest l ON l.conversation_id=c.id
ORDER BY c.id;
