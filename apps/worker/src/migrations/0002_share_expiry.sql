-- No account system exists yet, so all current rows are anonymous shares
-- created under the old (no-expiry) policy. Rather than backfilling a
-- retroactive expiry, we clear them — anyone with an old link will see a 404,
-- consistent with "shares aren't guaranteed to be permanent."
DELETE FROM systems;

ALTER TABLE systems ADD COLUMN expires_at INTEGER;
