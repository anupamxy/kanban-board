-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Main tasks table with field-level version tracking for conflict resolution
CREATE TABLE IF NOT EXISTS tasks (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT           NOT NULL DEFAULT 'New Task',
  description      TEXT           NOT NULL DEFAULT '',
  column_id        TEXT           NOT NULL DEFAULT 'todo'
                     CHECK (column_id IN ('todo', 'inprogress', 'done')),
  -- Fractional index: FLOAT8 gives ~15 significant digits of precision
  position         FLOAT8         NOT NULL DEFAULT 0,
  -- Global version, incremented on every write (used for optimistic locking)
  version          INTEGER        NOT NULL DEFAULT 1,
  -- Per-field versions: track which global version last touched each field.
  -- This allows the server to determine which fields actually changed in any
  -- given update, enabling field-level conflict merging.
  title_version    INTEGER        NOT NULL DEFAULT 1,
  description_version INTEGER     NOT NULL DEFAULT 1,
  column_version   INTEGER        NOT NULL DEFAULT 1,
  position_version INTEGER        NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Index for fast column queries (ordered by position)
CREATE INDEX IF NOT EXISTS idx_tasks_column_position
  ON tasks (column_id, position);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_updated_at ON tasks;
CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
