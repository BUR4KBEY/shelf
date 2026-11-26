-- One row each time a reader opens a doc, written only while view statistics are on (dashboard → Settings).
-- visitor: a hash of the reader's IP address and browser with the day, so readers can be counted without storing either;
-- the same reader on another day counts again. Rows go with their version.
CREATE TABLE views (
  doc_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  at INTEGER NOT NULL,
  visitor TEXT NOT NULL,
  FOREIGN KEY (doc_id, n) REFERENCES versions(doc_id, n) ON DELETE CASCADE
);
CREATE INDEX views_doc ON views(doc_id, n);
