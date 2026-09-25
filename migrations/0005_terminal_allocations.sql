-- Release/consume allocations in the same durable transaction as the reconciled
-- terminal state. A crash after persisting success cannot strand wallet locks.
CREATE TRIGGER reconcile_terminal_allocations AFTER UPDATE OF state,safe_to_retry ON attempts
WHEN NEW.state='FINALIZED' OR NEW.safe_to_retry=1 BEGIN
  UPDATE listings SET status='FILLED'
    WHERE NEW.state='FINALIZED' AND id IN (SELECT listing_id FROM room_listing_refs WHERE room_id=NEW.room_id);
  DELETE FROM active_locks WHERE attempt_id=NEW.id;
END;
