CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE, -- sha256 hex of the key; keys are 32 random bytes, so no slow hash
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE docs (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE,
  title TEXT,
  password_hash TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  latest INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (slug IS NULL OR password_hash IS NOT NULL) -- a guessable slug needs a password
);

CREATE TABLE versions (
  doc_id TEXT NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  manifest_hash TEXT NOT NULL,
  message TEXT,
  size INTEGER NOT NULL,
  key_id TEXT, -- NULL when uploaded from the dashboard
  created_at INTEGER NOT NULL,
  PRIMARY KEY (doc_id, n)
);

CREATE TABLE files (
  doc_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  PRIMARY KEY (doc_id, n, path),
  FOREIGN KEY (doc_id, n) REFERENCES versions(doc_id, n) ON DELETE CASCADE
);

CREATE INDEX files_sha ON files(sha256);
