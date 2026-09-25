-- Reserve provider request slots across Worker isolates. Waiting is wall time, not CPU.
CREATE TABLE rpc_slots (provider TEXT PRIMARY KEY, next_at INTEGER NOT NULL);
