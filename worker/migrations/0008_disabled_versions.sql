-- A disabled version stops answering at its pinned link (/view/<ref>@<n>) but keeps its files, so the owner can turn it back on.
-- The current version can't be disabled, so a doc's own link always serves something.
ALTER TABLE versions ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
