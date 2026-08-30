-- Shared by all rooms using the same deployment's Workers AI allowance.
CREATE TABLE judge_cooldowns (
  scope TEXT PRIMARY KEY,
  retry_at TEXT NOT NULL
);
