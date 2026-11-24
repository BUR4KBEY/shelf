-- App-wide settings the owner sets in the dashboard. A missing row means the default.
-- IF NOT EXISTS: the shared preview database got this table under an earlier migration name.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
