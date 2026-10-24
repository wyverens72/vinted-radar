CREATE TABLE catalog_progress (
 url TEXT PRIMARY KEY,
 nextPage INTEGER NOT NULL DEFAULT 2,
 complete INTEGER NOT NULL DEFAULT 0,
 checkedThrough INTEGER NOT NULL DEFAULT 1,
 fetchedAt INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE matches ADD COLUMN notified INTEGER NOT NULL DEFAULT 0;
UPDATE matches SET notified=1 WHERE EXISTS (SELECT 1 FROM outbox o WHERE o.searchId=matches.searchId AND o.itemId=matches.itemId);
