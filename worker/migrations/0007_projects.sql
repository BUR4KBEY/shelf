-- A project groups docs inside a space, e.g. one per thing an agent builds there. It is free text set on upload:
-- a project exists while a doc names it, so there is nothing to create or clean up. NULL: no project.
-- Numbered after 0006_views, not next to it: the try-it preview applies migrations by their position in name order.
ALTER TABLE docs ADD COLUMN project TEXT;
CREATE INDEX docs_project ON docs(space_id, project);
