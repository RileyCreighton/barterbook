-- Existing short-lived attempts and all prior journal records remain intact.
CREATE UNIQUE INDEX IF NOT EXISTS unique_frozen_nonce
ON attempts(json_extract(payload_json,'$.plan.terms.nonceAccount'),json_extract(payload_json,'$.plan.blockhash'))
WHERE json_extract(payload_json,'$.plan.terms.nonceAccount') IS NOT NULL;

CREATE TABLE IF NOT EXISTS nonce_operations (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('setup','cancel')),
  binding TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('PREPARED','SUBMISSION_STARTED','FINALIZED','FAILED','EXPIRED')),
  plan_json TEXT NOT NULL,
  wire_base64 TEXT NOT NULL,
  signed_wire_base64 TEXT,
  txid TEXT,
  created_at INTEGER NOT NULL,
  error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_nonce_operation
ON nonce_operations(wallet,binding) WHERE state IN ('PREPARED','SUBMISSION_STARTED');
CREATE TRIGGER IF NOT EXISTS immutable_nonce_operation BEFORE UPDATE ON nonce_operations BEGIN
  SELECT (CASE WHEN NEW.wallet<>OLD.wallet OR NEW.kind<>OLD.kind OR NEW.binding<>OLD.binding
    OR NEW.plan_json<>OLD.plan_json OR NEW.wire_base64<>OLD.wire_base64
    OR NEW.created_at<>OLD.created_at
    THEN RAISE(ABORT,'nonce operation identity is immutable') END);
  SELECT (CASE WHEN OLD.txid IS NOT NULL AND (NEW.txid IS NOT OLD.txid OR NEW.signed_wire_base64 IS NOT OLD.signed_wire_base64)
    THEN RAISE(ABORT,'nonce operation signature is immutable') END);
  SELECT (CASE WHEN NEW.state='SUBMISSION_STARTED' AND (NEW.txid IS NULL OR NEW.signed_wire_base64 IS NULL)
    THEN RAISE(ABORT,'persist signature before broadcast') END);
  SELECT (CASE WHEN OLD.state IN ('FINALIZED','FAILED','EXPIRED') AND NEW.state<>OLD.state
    THEN RAISE(ABORT,'terminal nonce operation') END);
END;
