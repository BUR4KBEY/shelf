-- How many bytes of versions a key may have on the shelf (NULL: no limit), and what a push over it does:
-- 'reject' refuses it, 'fifo' deletes the key's oldest uploads to make room.
ALTER TABLE api_keys ADD COLUMN quota_bytes INTEGER;
ALTER TABLE api_keys ADD COLUMN quota_strategy TEXT NOT NULL DEFAULT 'reject' CHECK (quota_strategy IN ('reject', 'fifo'));
