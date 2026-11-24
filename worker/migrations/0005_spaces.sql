-- Numbered 0005 next to 0005_key_quota: the shared preview database already applied it under this name, and its
-- ALTERs can't run twice. Wrangler applies by name, so it runs after 0005_key_quota everywhere else.
-- Spaces isolate API keys from each other: a key belongs to one space and sees only that space's docs.
-- Every existing key and doc lands in "default", so nothing changes until a second space exists.
-- keys_delete and keys_read_locked: whether the space's keys may delete docs and read password-protected ones without the password.
-- No REFERENCES on the new columns: SQLite can't add a foreign key column with a non-null default.
CREATE TABLE spaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  keys_delete INTEGER NOT NULL DEFAULT 1,
  keys_read_locked INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
INSERT INTO spaces (id, name, created_at) VALUES ('default', 'Default', unixepoch() * 1000);
ALTER TABLE api_keys ADD COLUMN space_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE docs ADD COLUMN space_id TEXT NOT NULL DEFAULT 'default';
CREATE INDEX docs_space ON docs(space_id);
