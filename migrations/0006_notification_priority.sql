ALTER TABLE outbox ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbox ADD COLUMN kind TEXT NOT NULL DEFAULT 'selection';
ALTER TABLE outbox ADD COLUMN scanOrder INTEGER NOT NULL DEFAULT 0;
-- Existing pending records have unknown page provenance: never label them as new listings.
UPDATE outbox SET text='Подборка по вашему поиску' || char(10) || text,
 payload=CASE WHEN json_extract(payload,'$.method')='sendPhoto' THEN json_set(payload,'$.caption','Подборка по вашему поиску' || char(10) || coalesce(json_extract(payload,'$.caption'),''),'$.fallbackText','Подборка по вашему поиску' || char(10) || coalesce(json_extract(payload,'$.fallbackText'),text))
 WHEN json_extract(payload,'$.method')='sendMessage' THEN json_set(payload,'$.text','Подборка по вашему поиску' || char(10) || coalesce(json_extract(payload,'$.text'),text)) ELSE payload END
 WHERE sentAt IS NULL AND payload IS NOT NULL;
CREATE INDEX outbox_priority_pending ON outbox(sentAt,priority,nextAttempt,createdAt);
