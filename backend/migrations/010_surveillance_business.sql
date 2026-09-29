-- Migration 010 -- Surveillance business unit.
--
-- Adds a third business unit, "surveillance", which clones Signage in every capability EXCEPT its
-- Services Offered list. Surveillance uses a different (larger) service catalogue, so rather than add
-- dozens of per-service columns it stores its ticked services as JSON in leads.services_json:
--   [{ "label": "...", "nature": "opex" | "capex", "rate": <number>, "qty": <number> }]
-- Signage/JHES are untouched and keep their existing per-service columns.
--
-- NOTE: keep this file free of the semicolon character except the statement terminators, because the
-- migration runner splits statements on it.

ALTER TABLE `users`
  MODIFY COLUMN `business_unit` enum('signage','jhes','surveillance') NOT NULL DEFAULT 'signage';

ALTER TABLE `leads`
  MODIFY COLUMN `business_unit` enum('signage','jhes','surveillance') NOT NULL DEFAULT 'signage';

ALTER TABLE `leads`
  ADD COLUMN `services_json` text DEFAULT NULL AFTER `additional_notes`;
