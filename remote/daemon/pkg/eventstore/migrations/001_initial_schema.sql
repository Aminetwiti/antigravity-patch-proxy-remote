-- 001_initial_schema.sql: Initial SQLite schema for Antigravity Remote Daemon

CREATE TABLE IF NOT EXISTS servers (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	hostname TEXT NOT NULL,
	platform TEXT NOT NULL,
	version TEXT NOT NULL,
	status TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
	id TEXT PRIMARY KEY,
	server_id TEXT NOT NULL,
	owner_id TEXT DEFAULT '',
	name TEXT NOT NULL,
	path TEXT NOT NULL,
	repo_url TEXT,
	branch TEXT,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	server_id TEXT NOT NULL,
	workspace_id TEXT NOT NULL,
	owner_id TEXT DEFAULT '',
	title TEXT NOT NULL,
	state TEXT NOT NULL,
	version INTEGER NOT NULL DEFAULT 1,
	last_sequence INTEGER NOT NULL DEFAULT 0,
	base_commit TEXT DEFAULT '',
	base_branch TEXT DEFAULT '',
	origin_commit TEXT DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
	session_id TEXT NOT NULL,
	sequence INTEGER NOT NULL,
	event_id TEXT NOT NULL UNIQUE,
	event_type TEXT NOT NULL,
	timestamp INTEGER NOT NULL,
	payload BLOB NOT NULL,
	PRIMARY KEY (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_events_session_seq ON events (session_id, sequence);

CREATE TABLE IF NOT EXISTS snapshots (
	session_id TEXT NOT NULL,
	sequence INTEGER NOT NULL,
	state TEXT NOT NULL,
	title TEXT NOT NULL,
	pending_data TEXT,
	captured_at INTEGER NOT NULL,
	PRIMARY KEY (session_id, sequence)
);

CREATE TABLE IF NOT EXISTS commands (
	command_id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	actor_id TEXT NOT NULL,
	command_type TEXT NOT NULL,
	payload_hash TEXT NOT NULL,
	status TEXT NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
	id TEXT PRIMARY KEY,
	owner_id TEXT DEFAULT '',
	workspace_id TEXT NOT NULL,
	session_id TEXT DEFAULT '',
	name TEXT NOT NULL,
	cron_expr TEXT NOT NULL,
	prompt TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	next_run_at INTEGER NOT NULL DEFAULT 0,
	last_run_at INTEGER NOT NULL DEFAULT 0,
	last_status TEXT DEFAULT '',
	retry_count INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_owner ON scheduled_jobs (owner_id);
