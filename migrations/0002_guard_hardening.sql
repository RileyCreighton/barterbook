-- Parenthesized CASE expressions preserve trigger bodies in the remote D1 SQL splitter.
-- Reapply transaction guards without deleting any rooms, attempts, signatures or locks.

DROP TRIGGER IF EXISTS session_consumes_challenge;
CREATE TRIGGER session_consumes_challenge BEFORE INSERT ON sessions BEGIN
  SELECT (CASE WHEN NOT EXISTS (
    SELECT 1 FROM auth_challenges WHERE id=NEW.challenge_id AND wallet=NEW.wallet
      AND origin=NEW.origin AND cluster=NEW.cluster AND consumed_at IS NULL
      AND expires_at > NEW.created_at
  ) THEN RAISE(ABORT, 'challenge expired or consumed') END);
END;

DROP TRIGGER IF EXISTS consume_challenge;
CREATE TRIGGER consume_challenge AFTER INSERT ON sessions BEGIN
  UPDATE auth_challenges SET consumed_at=NEW.created_at WHERE id=NEW.challenge_id;
END;

DROP TRIGGER IF EXISTS revision_requires_current_terms;
CREATE TRIGGER revision_requires_current_terms BEFORE INSERT ON room_revisions BEGIN
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM rooms WHERE id=NEW.room_id AND terms_version=NEW.version-1)
    THEN RAISE(ABORT,'stale terms version') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE room_id=NEW.room_id AND safe_to_retry=0)
    THEN RAISE(ABORT,'room has unresolved or successful attempt') END);
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM room_members WHERE room_id=NEW.room_id AND wallet=NEW.proposer)
    THEN RAISE(ABORT,'proposer is not a participant') END);
END;

DROP TRIGGER IF EXISTS apply_revision;
CREATE TRIGGER apply_revision AFTER INSERT ON room_revisions BEGIN
  UPDATE rooms SET terms_version=NEW.version,terms_hash=NEW.terms_hash,terms_json=NEW.terms_json,
    state='NEGOTIATING',current_attempt_id=NULL WHERE id=NEW.room_id;
  UPDATE room_members SET accepted_version=NULL,ready=0 WHERE room_id=NEW.room_id;
  UPDATE offers SET status='SUPERSEDED' WHERE room_id=NEW.room_id AND status IN ('OPEN','ACCEPTED');
END;

DROP TRIGGER IF EXISTS room_members_consent;
CREATE TRIGGER room_members_consent BEFORE UPDATE OF accepted_version,ready ON room_members BEGIN
  SELECT (CASE WHEN NEW.accepted_version IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM rooms WHERE id=NEW.room_id AND terms_version=NEW.accepted_version)
    THEN RAISE(ABORT,'stale acceptance') END);
  SELECT (CASE WHEN NEW.ready=1 AND NEW.accepted_version IS NULL THEN RAISE(ABORT,'accept terms before readiness') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE room_id=NEW.room_id AND safe_to_retry=0)
    THEN RAISE(ABORT,'attempt already frozen') END);
END;

DROP TRIGGER IF EXISTS attempt_requires_ready_room;
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

DROP TRIGGER IF EXISTS immutable_attempt;
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

DROP TRIGGER IF EXISTS lock_consistency;
CREATE TRIGGER lock_consistency BEFORE INSERT ON active_locks BEGIN
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM attempts WHERE id=NEW.attempt_id AND room_id=NEW.room_id AND safe_to_retry=0)
    THEN RAISE(ABORT,'lock requires active attempt') END);
END;

DROP TRIGGER IF EXISTS room_listing_eligible;
CREATE TRIGGER room_listing_eligible BEFORE INSERT ON room_listing_refs BEGIN
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM listings l JOIN rooms r ON r.id=NEW.room_id
    JOIN room_members m ON m.room_id=r.id AND m.wallet=l.owner
    WHERE l.id=NEW.listing_id AND l.cluster=r.cluster AND l.status='OPEN'
      AND l.version=NEW.listing_version AND l.expires_at>r.created_at)
    THEN RAISE(ABORT,'listing is stale or unavailable') END);
END;

DROP TRIGGER IF EXISTS attempt_requires_current_listings;
CREATE TRIGGER attempt_requires_current_listings BEFORE INSERT ON attempts BEGIN
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM room_listing_refs x JOIN listings l ON l.id=x.listing_id
    WHERE x.room_id=NEW.room_id AND (l.version<>x.listing_version OR l.status<>'OPEN' OR l.expires_at<=NEW.created_at))
    THEN RAISE(ABORT,'source listing changed or expired') END);
END;

DROP TRIGGER IF EXISTS prevent_unsafe_unlock;
CREATE TRIGGER prevent_unsafe_unlock BEFORE DELETE ON active_locks BEGIN
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE id=OLD.attempt_id AND safe_to_retry=0 AND state<>'FINALIZED')
    THEN RAISE(ABORT,'attempt must be reconciled before releasing locks') END);
END;

DROP TRIGGER IF EXISTS prevent_locked_listing_withdrawal;
CREATE TRIGGER prevent_locked_listing_withdrawal BEFORE UPDATE OF status ON listings BEGIN
  SELECT (CASE WHEN NEW.status='WITHDRAWN' AND EXISTS(SELECT 1 FROM active_locks WHERE lock_key='listing:'||OLD.id)
    THEN RAISE(ABORT,'listing belongs to an active attempt') END);
END;

DROP TRIGGER IF EXISTS reject_room_current;
CREATE TRIGGER reject_room_current BEFORE INSERT ON events WHEN NEW.kind='ROOM_REJECTED' BEGIN
  SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM rooms r JOIN room_members m ON m.room_id=r.id
    WHERE r.id=NEW.room_id AND r.terms_version=json_extract(NEW.detail_json,'$.version')
      AND r.terms_hash=json_extract(NEW.detail_json,'$.termsHash') AND m.wallet=json_extract(NEW.detail_json,'$.wallet'))
    THEN RAISE(ABORT,'stale rejection or unauthorized participant') END);
  SELECT (CASE WHEN EXISTS(SELECT 1 FROM attempts WHERE room_id=NEW.room_id AND safe_to_retry=0)
    THEN RAISE(ABORT,'attempt already frozen') END);
END;

DROP TRIGGER IF EXISTS apply_room_rejection;
CREATE TRIGGER apply_room_rejection AFTER INSERT ON events WHEN NEW.kind='ROOM_REJECTED' BEGIN
  UPDATE room_members SET accepted_version=NULL,ready=0 WHERE room_id=NEW.room_id;
  UPDATE offers SET status='REJECTED' WHERE room_id=NEW.room_id AND version=json_extract(NEW.detail_json,'$.version');
  UPDATE rooms SET state='REJECTED' WHERE id=NEW.room_id;
END;

DROP TRIGGER IF EXISTS cap_open_listings;
CREATE TRIGGER cap_open_listings BEFORE INSERT ON listings BEGIN
  SELECT (CASE WHEN (SELECT COUNT(*) FROM listings WHERE owner=NEW.owner AND cluster=NEW.cluster
    AND status='OPEN' AND expires_at>NEW.created_at)>=20 THEN RAISE(ABORT,'open listing limit') END);
END;

DROP TRIGGER IF EXISTS reflect_attempt_state;
CREATE TRIGGER reflect_attempt_state AFTER UPDATE OF state ON attempts BEGIN
  UPDATE rooms SET state=NEW.state WHERE id=NEW.room_id AND current_attempt_id=NEW.id;
END;
