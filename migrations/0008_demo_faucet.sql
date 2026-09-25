CREATE TABLE demo_faucet_claims (
 id TEXT PRIMARY KEY, wallet TEXT NOT NULL, plan_json TEXT NOT NULL,
 wire_base64 TEXT NOT NULL, signed_wire_base64 TEXT, txid TEXT UNIQUE,
 state TEXT NOT NULL DEFAULT 'PREPARED', created_at INTEGER NOT NULL,
 CHECK ((signed_wire_base64 IS NULL)=(txid IS NULL))
);
CREATE INDEX demo_faucet_wallet ON demo_faucet_claims(wallet,created_at);
CREATE TRIGGER demo_faucet_immutable BEFORE UPDATE ON demo_faucet_claims
WHEN OLD.wallet<>NEW.wallet OR OLD.plan_json<>NEW.plan_json OR OLD.wire_base64<>NEW.wire_base64
 OR (OLD.txid IS NOT NULL AND (NEW.txid IS NOT OLD.txid OR NEW.signed_wire_base64 IS NOT OLD.signed_wire_base64))
BEGIN SELECT RAISE(ABORT,'Immutable faucet request'); END;
