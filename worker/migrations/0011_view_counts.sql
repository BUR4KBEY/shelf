-- One row per reader, version and 15-minute slot (since 1970) instead of one per open, so reloading a doc in a loop
-- can't grow the table without bound. `count`: opens in that slot; `at`: the latest one. Slots are 15 minutes so that
-- every real time zone's day starts on a slot boundary, and the dashboard's per-day counts in the reader's time zone
-- stay exact. The daily sweep drops rows older than the analytics window.
CREATE TABLE view_counts (
  doc_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  visitor TEXT NOT NULL,
  at INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (doc_id, n, slot, visitor),
  FOREIGN KEY (doc_id, n) REFERENCES versions(doc_id, n) ON DELETE CASCADE
);
INSERT INTO view_counts (doc_id, n, slot, visitor, at, count)
  SELECT doc_id, n, at / 900000, visitor, MAX(at), COUNT(*) FROM views GROUP BY doc_id, n, at / 900000, visitor;
DROP TABLE views;
ALTER TABLE view_counts RENAME TO views;
CREATE INDEX views_at ON views(at);
