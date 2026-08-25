CREATE TABLE agent_pairings (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  conflict_id TEXT REFERENCES conflicts(id),
  code_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  revoked_at TEXT,
  client_name TEXT,
  credential_id TEXT,
  credential_hash TEXT,
  credential_prefix TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_agent_pairings_code ON agent_pairings(code_hash);
CREATE INDEX idx_agent_pairings_agent ON agent_pairings(agent_id, created_at DESC);
