CREATE TABLE asset_cache (
  cluster TEXT PRIMARY KEY, registry_hash TEXT NOT NULL, payload_json TEXT NOT NULL, checked_at INTEGER NOT NULL
);
