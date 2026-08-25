PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE auth_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_subject)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_tokens (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE conflicts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  protocol_type TEXT NOT NULL CHECK(protocol_type IN ('debate', 'persuasion')),
  status TEXT NOT NULL CHECK(status IN ('draft','inviting','briefing','active','judging','resolved','paused','cancelled','expired')),
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  current_phase TEXT CHECK(current_phase IS NULL OR current_phase IN ('opening','rebuttal','closing')),
  current_round INTEGER NOT NULL DEFAULT 0,
  first_speaker_party_id TEXT,
  max_rounds INTEGER NOT NULL DEFAULT 3,
  deadline_at TEXT,
  turn_timeout_seconds INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  persuader_party TEXT CHECK(persuader_party IS NULL OR persuader_party IN ('party_a','party_b')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE conflict_parties (
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL REFERENCES conflicts(id),
  role TEXT NOT NULL CHECK(role IN ('party_a','party_b')),
  user_id TEXT REFERENCES users(id),
  display_name TEXT NOT NULL,
  agent_id TEXT REFERENCES agents(id),
  ready INTEGER NOT NULL DEFAULT 0,
  persuasion_role TEXT CHECK(persuasion_role IS NULL OR persuasion_role IN ('persuader','target')),
  joined_at TEXT,
  UNIQUE(conflict_id, role),
  UNIQUE(conflict_id, user_id)
);

CREATE TABLE conflict_invites (
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL REFERENCES conflicts(id),
  target_role TEXT NOT NULL CHECK(target_role = 'party_b'),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE private_briefs (
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL REFERENCES conflicts(id),
  party_id TEXT NOT NULL REFERENCES conflict_parties(id),
  content_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  UNIQUE(conflict_id, party_id)
);

CREATE TABLE conflict_events (
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL REFERENCES conflicts(id),
  sequence_number INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK(actor_type IN ('user','agent','system','judge')),
  actor_id TEXT,
  party_id TEXT,
  party_role TEXT CHECK(party_role IS NULL OR party_role IN ('party_a','party_b')),
  visibility TEXT NOT NULL CHECK(visibility IN ('party_private','case','observer','judge_only')),
  payload_json TEXT NOT NULL,
  client_request_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(conflict_id, sequence_number),
  UNIQUE(conflict_id, client_request_id)
);

CREATE TABLE verdicts (
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL UNIQUE REFERENCES conflicts(id),
  verdict_json TEXT NOT NULL,
  provider TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE share_links (
  id TEXT PRIMARY KEY,
  conflict_id TEXT NOT NULL REFERENCES conflicts(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT,
  revoked_at TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  conflict_id TEXT REFERENCES conflicts(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE analytics_events (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  user_id TEXT,
  conflict_id TEXT,
  properties_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_conflicts_creator ON conflicts(created_by_user_id, updated_at DESC);
CREATE INDEX idx_parties_user ON conflict_parties(user_id, conflict_id);
CREATE INDEX idx_events_conflict_sequence ON conflict_events(conflict_id, sequence_number);
CREATE INDEX idx_tokens_hash ON agent_tokens(token_hash);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at, created_at DESC);
CREATE INDEX idx_share_hash ON share_links(token_hash);
CREATE INDEX idx_invite_hash ON conflict_invites(token_hash);
