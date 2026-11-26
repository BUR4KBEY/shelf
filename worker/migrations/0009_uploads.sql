-- Blobs a key uploaded that no push has put in a doc yet. They count against the key's quota until a push commits them
-- or the daily sweep drops the row (with the blob, when nothing references it). A row also proves the key had the
-- bytes, so an isolated key may push a blob it uploaded even when only another space's docs hold it.
CREATE TABLE uploads (
  key_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (key_id, sha256)
);
