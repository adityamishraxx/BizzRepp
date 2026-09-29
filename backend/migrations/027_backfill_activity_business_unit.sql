-- Backfill business_unit on activity_log rows that were created before the
-- code started stamping it. Lead events inherit from the lead row. Chain and
-- SLA events inherit from the actor (user) row. Permission events stay NULL
-- because they are cross-platform by nature.

UPDATE `activity_log` a
  JOIN `leads` l ON a.lead_id = l.id
SET a.business_unit = l.business_unit
WHERE a.entity_type = 'lead' AND a.business_unit IS NULL;

UPDATE `activity_log` a
  JOIN `users` u ON a.user_id = u.id
SET a.business_unit = u.business_unit
WHERE a.entity_type IN ('chain', 'sla') AND a.business_unit IS NULL;
