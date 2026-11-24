-- A key's page reads every version that key uploaded.
CREATE INDEX IF NOT EXISTS versions_key ON versions(key_id, created_at);
