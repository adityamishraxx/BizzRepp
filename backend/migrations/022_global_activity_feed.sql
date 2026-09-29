-- Migration 022 -- Global cross-user activity feed.
--
-- activity_log already records lead field changes and powers the per-lead Activity tab, but it
-- can only hold lead events: lead_id is NOT NULL. This widens the same table rather than adding a
-- second one, so the per-lead tab and the global feed read one store and can never disagree.
--
--   lead_id       -> nullable, so a chain / permissions / SLA event can be recorded
--   entity_type   -> 'lead' | 'chain' | 'permissions' | 'sla', the feed's category tag
--   entity_id     -> the chain id, target user id, etc. (lead_id still carries lead events)
--   business_unit -> which platform the event belongs to, for scoping and the platform filter.
--                    NULL means cross-platform (e.g. a Super Admin grant), visible to admins only.
--
-- The backfill stamps every existing row as a lead event and copies the platform from its lead, so
-- history is filterable from day one rather than only new events.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `activity_log`
  MODIFY COLUMN `lead_id` int DEFAULT NULL,
  ADD COLUMN `entity_type`   varchar(32) NOT NULL DEFAULT 'lead' AFTER `lead_id`,
  ADD COLUMN `entity_id`     int         DEFAULT NULL            AFTER `entity_type`,
  ADD COLUMN `business_unit` varchar(32) DEFAULT NULL            AFTER `entity_id`;

UPDATE `activity_log` a JOIN `leads` l ON l.id = a.lead_id SET a.business_unit = l.business_unit WHERE a.business_unit IS NULL;

UPDATE `activity_log` SET `entity_id` = `lead_id` WHERE `entity_type` = 'lead' AND `entity_id` IS NULL;

-- The feed is always ordered newest-first and usually filtered by type, so index both.
CREATE INDEX `idx_activity_created` ON `activity_log` (`created_at`);

CREATE INDEX `idx_activity_type_created` ON `activity_log` (`entity_type`, `created_at`);
