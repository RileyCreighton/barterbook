-- Bounded chronological public receipt queries; existing history is preserved.
CREATE INDEX attempts_public_history ON attempts(state,created_at DESC,txid DESC);
CREATE INDEX attempts_txid ON attempts(txid);
