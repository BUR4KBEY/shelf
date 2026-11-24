-- Doc ids are lowercase now so links work in any case. Child rows are rewritten in the same
-- transaction; the foreign keys are only checked at its end. A collision aborts the migration.
PRAGMA defer_foreign_keys = on;
UPDATE docs SET id = lower(id) WHERE id != lower(id);
UPDATE versions SET doc_id = lower(doc_id) WHERE doc_id != lower(doc_id);
UPDATE files SET doc_id = lower(doc_id) WHERE doc_id != lower(doc_id);
