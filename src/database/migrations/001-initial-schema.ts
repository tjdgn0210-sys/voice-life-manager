/** Immutable migration SQL. Never interpolate user input or edit an applied migration. */
export const initialSchemaSql = `
CREATE TABLE transactions (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('EXPENSE', 'INCOME')),
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0 AND amount <= 9007199254740991),
  currency_code TEXT NOT NULL DEFAULT 'KRW',
  category TEXT,
  memo TEXT,
  occurred_at TEXT NOT NULL,
  input_method TEXT NOT NULL CHECK (input_method IN ('MANUAL', 'VOICE', 'TEXT')),
  raw_input TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
  completed_at TEXT,
  source_action_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE events (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  time_kind TEXT NOT NULL CHECK (time_kind IN ('EXACT', 'FUZZY')),
  start_at TEXT,
  fuzzy_time TEXT,
  end_at TEXT,
  timezone TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL CHECK (status IN ('UPCOMING', 'PAST', 'COMPLETED', 'CANCELLED')),
  source_action_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (
    (time_kind = 'EXACT' AND start_at IS NOT NULL AND fuzzy_time IS NULL)
    OR (time_kind = 'FUZZY' AND start_at IS NULL AND fuzzy_time IS NOT NULL AND length(trim(fuzzy_time)) > 0)
  )
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY NOT NULL,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array'),
  input_method TEXT NOT NULL CHECK (input_method IN ('MANUAL', 'VOICE', 'TEXT')),
  raw_input TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE reminders (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('TASK', 'EVENT')),
  target_id TEXT NOT NULL,
  fire_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  relative_offset_minutes INTEGER
    CHECK (relative_offset_minutes IS NULL OR typeof(relative_offset_minutes) = 'integer'),
  status TEXT NOT NULL CHECK (status IN ('REQUESTED', 'PERMISSION_BLOCKED', 'SCHEDULED', 'CANCELLED')),
  delivery_mode TEXT NOT NULL CHECK (delivery_mode = 'LOCAL'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  CHECK (
    (status = 'CANCELLED' AND cancelled_at IS NOT NULL)
    OR (status <> 'CANCELLED' AND cancelled_at IS NULL)
  )
);

CREATE TABLE action_logs (
  id TEXT PRIMARY KEY NOT NULL,
  raw_input TEXT NOT NULL,
  proposal_json TEXT NOT NULL
    CHECK (json_valid(proposal_json) AND json_type(proposal_json) = 'object'),
  validation_result_json TEXT
    CHECK (validation_result_json IS NULL OR (json_valid(validation_result_json) AND json_type(validation_result_json) = 'object')),
  execution_result_json TEXT
    CHECK (execution_result_json IS NULL OR (json_valid(execution_result_json) AND json_type(execution_result_json) = 'object')),
  created_at TEXT NOT NULL
);

-- Evidence is appended, never updated. DELETE is not blocked: explicit privacy erasure
-- must remain possible. Future repositories must use INSERT, never INSERT OR REPLACE.
CREATE TRIGGER action_logs_reject_update
BEFORE UPDATE ON action_logs
BEGIN
  SELECT RAISE(ABORT, 'Action logs are append-only');
END;

-- Recent live transactions / date-range history.
CREATE INDEX transactions_occurred_at_idx ON transactions (occurred_at DESC) WHERE deleted_at IS NULL;
-- Active task lists filtered by status, then ordered by due time.
CREATE INDEX tasks_status_due_at_idx ON tasks (status, due_at) WHERE deleted_at IS NULL;
-- Event lists filtered by lifecycle state, then start time.
CREATE INDEX events_status_start_at_idx ON events (status, start_at) WHERE deleted_at IS NULL;
-- Scheduling/reconciliation queries select a status and upcoming fire times.
CREATE INDEX reminders_status_fire_at_idx ON reminders (status, fire_at);
-- Recent append-only evidence.
CREATE INDEX action_logs_created_at_idx ON action_logs (created_at DESC);
`;
