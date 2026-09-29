-- Dynamic Business Units, Phase 3 (metadata) - custom field value storage.
-- Adds a single JSON column to hold the values of CUSTOM fields defined per business unit through the
-- creation wizard (fields that have no dedicated leads column). Values are keyed by field slug, e.g.
-- {"gstin": "22AAAAA0000A1Z5", "region": "North"}. Predefined/core fields keep their real columns;
-- this is only for admin-defined custom fields, so a new field never needs a schema change again.
-- Keep this file free of semicolons except as statement terminators.

ALTER TABLE `leads` ADD COLUMN `custom_fields` JSON DEFAULT NULL AFTER `additional_notes`;
