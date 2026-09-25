-- Parenthesized CASE expressions preserve trigger bodies in the remote D1 SQL splitter.
PRAGMA foreign_keys = ON;
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY, wallet TEXT NOT NULL, origin TEXT NOT NULL, cluster TEXT NOT NULL,
  message TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX auth_challenges_wallet ON auth_challenges(wallet, expires_at);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, challenge_id TEXT NOT NULL UNIQUE REFERENCES auth_challenges(id),
  wallet TEXT NOT NULL, origin TEXT NOT NULL, cluster TEXT NOT NULL, expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TRIGGER session_consumes_challenge BEFORE INSERT ON sessions BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM auth_challenges WHERE id=NEW.challenge_id AND wallet=NEW.wallet
      AND origin=NEW.origin AND cluster=NEW.cluster AND consumed_at IS NULL
      AND expires_at > NEW.created_at
  ) THEN RAISE(ABORT, 'challenge expired or consumed') END);
END;
CREATE TRIGGER consume_challenge AFTER INSERT ON sessions BEGIN
  UPDATE auth_challenges SET consumed_at=NEW.created_at WHERE id=NEW.challenge_id;
END;
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY, hits INTEGER NOT NULL, limit_count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, CHECK(hits >= 1 AND hits <= limit_count)
);
CREATE INDEX rate_limits_expiry ON rate_limits(expires_at);
CREATE TABLE listings (
  id TEXT PRIMARY KEY, owner TEXT NOT NULL, cluster TEXT NOT NULL,
  give_mint TEXT NOT NULL, want_mint TEXT NOT NULL, gross_raw TEXT NOT NULL,
  min_receive_net_raw TEXT NOT NULL, expires_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK(status IN ('OPEN','WITHDRAWN','FILLED')), created_at INTEGER NOT NULL,
  balance_raw TEXT NOT NULL, balance_checked_at INTEGER NOT NULL,
  CHECK(give_mint <> want_mint), CHECK(version > 0),
  CHECK(typeof(gross_raw)='text' AND length(gross_raw)>0 AND gross_raw NOT GLOB '*[^0-9]*' AND gross_raw NOT LIKE '0%'),
  CHECK(typeof(min_receive_net_raw)='text' AND length(min_receive_net_raw)>0 AND min_receive_net_raw NOT GLOB '*[^0-9]*' AND min_receive_net_raw NOT LIKE '0%')
);
CREATE INDEX listings_market ON listings(cluster,status,give_mint,want_mint,created_at DESC);
CREATE INDEX listings_owner ON listings(owner,status,created_at DESC);
CREATE TABLE rooms (
  id TEXT PRIMARY KEY, cluster TEXT NOT NULL, mode TEXT NOT NULL CHECK(mode IN ('BASKET','RING')),
  terms_version INTEGER NOT NULL DEFAULT 0, terms_hash TEXT NOT NULL DEFAULT '', terms_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'NEGOTIATING', current_attempt_id TEXT,
  listing_ids_json TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL
);
CREATE TABLE room_members (
  room_id TEXT NOT NULL REFERENCES rooms(id), wallet TEXT NOT NULL,
  accepted_version INTEGER, ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1)),
  PRIMARY KEY(room_id,wallet)
);
CREATE INDEX room_members_wallet ON room_members(wallet,room_id);
CREATE TABLE room_revisions (
  room_id TEXT NOT NULL REFERENCES rooms(id), version INTEGER NOT NULL,
  terms_json TEXT NOT NULL, terms_hash TEXT NOT NULL, proposer TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY(room_id,version)
);
CREATE TABLE offers (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), proposer TEXT NOT NULL,
  recipient TEXT NOT NULL, version INTEGER NOT NULL, previous_offer_id TEXT REFERENCES offers(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','SUPERSEDED','ACCEPTED','REJECTED')),
  created_at INTEGER NOT NULL, UNIQUE(room_id,version),
  FOREIGN KEY(room_id,version) REFERENCES room_revisions(room_id,version)
);
CREATE INDEX offers_participants ON offers(recipient,status,created_at DESC);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), terms_hash TEXT NOT NULL,
  state TEXT NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  txid TEXT, safe_to_retry INTEGER NOT NULL DEFAULT 0 CHECK(safe_to_retry IN (0,1)),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  CHECK(json_extract(payload_json,'$.id')=id),
  CHECK(json_extract(payload_json,'$.roomId')=room_id),
  CHECK(json_extract(payload_json,'$.termsHash')=terms_hash),
  CHECK(json_extract(payload_json,'$.state')=state),
  CHECK(json_extract(payload_json,'$.safeToRetry')=safe_to_retry),
  CHECK(json_extract(payload_json,'$.txid') IS txid),
  CHECK(state NOT IN ('SUBMISSION_STARTED','SUBMITTED','CONFIRMED','FINALIZED') OR
    (txid IS NOT NULL AND json_extract(payload_json,'$.fullWireBase64') IS NOT NULL AND json_extract(payload_json,'$.submissionStartedAt') IS NOT NULL)),
  CHECK(safe_to_retry=0 OR state IN ('FAILED_ONCHAIN','EXPIRED_UNLANDED','STOPPED'))
);
CREATE INDEX attempts_room ON attempts(room_id,created_at DESC);
CREATE INDEX attempts_recovery ON attempts(safe_to_retry,state,updated_at);
CREATE TABLE active_locks (
  lock_key TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id),
  room_id TEXT NOT NULL REFERENCES rooms(id), created_at INTEGER NOT NULL
);
CREATE INDEX active_locks_attempt ON active_locks(attempt_id);
CREATE TABLE signatures (
  attempt_id TEXT NOT NULL REFERENCES attempts(id), signer TEXT NOT NULL,
  signature_base64 TEXT NOT NULL, verified_at INTEGER NOT NULL, PRIMARY KEY(attempt_id,signer)
);
CREATE TABLE events (
  id TEXT PRIMARY KEY, room_id TEXT REFERENCES rooms(id), attempt_id TEXT REFERENCES attempts(id),
  kind TEXT NOT NULL, detail_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE INDEX events_room ON events(room_id,created_at);
CREATE TRIGGER revision_requires_current_terms BEFORE INSERT ON room_revisions BEGIN
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM rooms WHERE id=NEW.room_id AND terms_version=NEW.version-1)
    THEN RAISE(ABORT,'stale terms version') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE room_id=NEW.room_id AND safe_to_retry=0)
    THEN RAISE(ABORT,'room has unresolved or successful attempt') END);
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM room_members WHERE room_id=NEW.room_id AND wallet=NEW.proposer)
    THEN RAISE(ABORT,'proposer is not a participant') END);
END;
CREATE TRIGGER apply_revision AFTER INSERT ON room_revisions BEGIN
  UPDATE rooms SET terms_version=NEW.version,terms_hash=NEW.terms_hash,terms_json=NEW.terms_json,
    state='NEGOTIATING',current_attempt_id=NULL WHERE id=NEW.room_id;
  UPDATE room_members SET accepted_version=NULL,ready=0 WHERE room_id=NEW.room_id;
  UPDATE offers SET status='SUPERSEDED' WHERE room_id=NEW.room_id AND status IN ('OPEN','ACCEPTED');
END;
CREATE TRIGGER room_members_consent BEFORE UPDATE OF accepted_version,ready ON room_members BEGIN
  SELECT (CASE WHEN NEW.accepted_version IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM rooms WHERE id=NEW.room_id AND terms_version=NEW.accepted_version)
    THEN RAISE(ABORT,'stale acceptance') END);
  SELECT (CASE WHEN NEW.ready=1 AND NEW.accepted_version IS NULL THEN RAISE(ABORT,'accept terms before readiness') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE room_id=NEW.room_id AND safe_to_retry=0)
    THEN RAISE(ABORT,'attempt already frozen') END);
END;
CREATE TRIGGER attempt_requires_ready_room BEFORE INSERT ON attempts BEGIN
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM rooms WHERE id=NEW.room_id AND terms_hash=NEW.terms_hash
      AND terms_version=json_extract(NEW.payload_json,'$.plan.terms.version')
      AND state IN ('ACCEPTED','READY') AND json_extract(terms_json,'$.expiresAt')>NEW.created_at)
    THEN RAISE(ABORT,'attempt terms changed') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM room_members m JOIN rooms r ON r.id=m.room_id
      WHERE m.room_id=NEW.room_id AND (m.accepted_version IS NOT r.terms_version OR m.ready<>1))
    THEN RAISE(ABORT,'participants are not ready') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE room_id=NEW.room_id AND safe_to_retry=0)
    THEN RAISE(ABORT,'room has an unresolved attempt') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE room_id=NEW.room_id AND terms_hash=NEW.terms_hash)
    THEN RAISE(ABORT,'new attempt requires revised terms and consent') END);
  SELECT (CASE WHEN NEW.state<>'SIGNING' OR NEW.safe_to_retry<>0 THEN RAISE(ABORT,'invalid initial attempt') END);
END;
CREATE TRIGGER immutable_attempt BEFORE UPDATE ON attempts BEGIN
  SELECT (CASE WHEN NEW.room_id<>OLD.room_id OR NEW.terms_hash<>OLD.terms_hash
    OR json_extract(NEW.payload_json,'$.messageBase64') IS NOT json_extract(OLD.payload_json,'$.messageBase64')
    OR json_extract(NEW.payload_json,'$.messageHash') IS NOT json_extract(OLD.payload_json,'$.messageHash')
    OR json_extract(NEW.payload_json,'$.plan') IS NOT json_extract(OLD.payload_json,'$.plan')
    THEN RAISE(ABORT,'attempt message is immutable') END);
  SELECT (CASE WHEN OLD.txid IS NOT NULL AND NEW.txid IS NOT OLD.txid THEN RAISE(ABORT,'transaction identity is immutable') END);
  SELECT (CASE WHEN json_extract(OLD.payload_json,'$.fullWireBase64') IS NOT NULL
    AND json_extract(NEW.payload_json,'$.fullWireBase64') IS NOT json_extract(OLD.payload_json,'$.fullWireBase64')
    THEN RAISE(ABORT,'signed transaction bytes are immutable') END);
  SELECT (CASE WHEN json_extract(OLD.payload_json,'$.submissionStartedAt') IS NOT NULL
    AND json_extract(NEW.payload_json,'$.submissionStartedAt') IS NOT json_extract(OLD.payload_json,'$.submissionStartedAt')
    THEN RAISE(ABORT,'submission marker is immutable') END);
END;
CREATE TRIGGER lock_consistency BEFORE INSERT ON active_locks BEGIN
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM attempts WHERE id=NEW.attempt_id AND room_id=NEW.room_id AND safe_to_retry=0)
    THEN RAISE(ABORT,'lock requires active attempt') END);
END;
CREATE TABLE room_listing_refs (
  room_id TEXT NOT NULL REFERENCES rooms(id), listing_id TEXT NOT NULL REFERENCES listings(id),
  listing_version INTEGER NOT NULL, PRIMARY KEY(room_id,listing_id)
);
CREATE TRIGGER room_listing_eligible BEFORE INSERT ON room_listing_refs BEGIN
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM listings l JOIN rooms r ON r.id=NEW.room_id
    JOIN room_members m ON m.room_id=r.id AND m.wallet=l.owner
    WHERE l.id=NEW.listing_id AND l.cluster=r.cluster AND l.status='OPEN'
      AND l.version=NEW.listing_version AND l.expires_at>r.created_at)
    THEN RAISE(ABORT,'listing is stale or unavailable') END);
END;
CREATE TRIGGER attempt_requires_current_listings BEFORE INSERT ON attempts BEGIN
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM room_listing_refs x JOIN listings l ON l.id=x.listing_id
    WHERE x.room_id=NEW.room_id AND (l.version<>x.listing_version OR l.status<>'OPEN' OR l.expires_at<=NEW.created_at))
    THEN RAISE(ABORT,'source listing changed or expired') END);
END;
CREATE TRIGGER prevent_unsafe_unlock BEFORE DELETE ON active_locks BEGIN
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE id=OLD.attempt_id AND safe_to_retry=0 AND state<>'FINALIZED')
    THEN RAISE(ABORT,'attempt must be reconciled before releasing locks') END);
END;
CREATE TRIGGER prevent_locked_listing_withdrawal BEFORE UPDATE OF status ON listings BEGIN
  SELECT (CASE WHEN NEW.status='WITHDRAWN' AND EXISTS(SELECT 1 FROM active_locks WHERE lock_key='listing:'||OLD.id)
    THEN RAISE(ABORT,'listing belongs to an active attempt') END);
END;
CREATE TRIGGER reject_room_current BEFORE INSERT ON events WHEN NEW.kind='ROOM_REJECTED' BEGIN
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM rooms r JOIN room_members m ON m.room_id=r.id
    WHERE r.id=NEW.room_id AND r.terms_version=json_extract(NEW.detail_json,'$.version')
      AND r.terms_hash=json_extract(NEW.detail_json,'$.termsHash') AND m.wallet=json_extract(NEW.detail_json,'$.wallet'))
    THEN RAISE(ABORT,'stale rejection or unauthorized participant') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE room_id=NEW.room_id AND safe_to_retry=0)
    THEN RAISE(ABORT,'attempt already frozen') END);
END;
CREATE TRIGGER apply_room_rejection AFTER INSERT ON events WHEN NEW.kind='ROOM_REJECTED' BEGIN
  UPDATE room_members SET accepted_version=NULL,ready=0 WHERE room_id=NEW.room_id;
  UPDATE offers SET status='REJECTED' WHERE room_id=NEW.room_id AND version=json_extract(NEW.detail_json,'$.version');
  UPDATE rooms SET state='REJECTED' WHERE id=NEW.room_id;
END;
CREATE TRIGGER cap_open_listings BEFORE INSERT ON listings BEGIN
  SELECT (CASE WHEN (SELECT COUNT(*) FROM listings WHERE owner=NEW.owner AND cluster=NEW.cluster
    AND status='OPEN' AND expires_at>NEW.created_at)>=20 THEN RAISE(ABORT,'open listing limit') END);
END;
CREATE TRIGGER reflect_attempt_state AFTER UPDATE OF state ON attempts BEGIN
  UPDATE rooms SET state=NEW.state WHERE id=NEW.room_id AND current_attempt_id=NEW.id;
END;
