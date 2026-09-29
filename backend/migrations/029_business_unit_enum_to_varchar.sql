-- Dynamic Business Units, Phase 1 (foundation) - part 2.
-- Converts the three business_unit ENUM columns to VARCHAR(32) and adds foreign
-- keys onto business_units(slug), so a new business unit no longer needs an
-- ALTER TABLE ... MODIFY COLUMN (DDL) to be usable. MySQL preserves the existing
-- string values ('signage'/'jhes'/'surveillance') across the ENUM->VARCHAR change,
-- and migration 028 already seeded matching slugs, so no row data changes here.
-- Keep this file free of semicolons except as statement terminators.

ALTER TABLE `users`      MODIFY COLUMN `business_unit` VARCHAR(32) NOT NULL DEFAULT 'signage';
ALTER TABLE `leads`      MODIFY COLUMN `business_unit` VARCHAR(32) NOT NULL DEFAULT 'signage';
ALTER TABLE `global_pos` MODIFY COLUMN `business_unit` VARCHAR(32) NOT NULL DEFAULT 'signage';

-- Referential integrity: every business_unit value must be a real business unit.
-- ON UPDATE CASCADE means renaming a slug (rare, admin-only) propagates to all rows.
-- No ON DELETE action is set (RESTRICT by default), so a business unit with any
-- users/leads/global_pos cannot be hard-deleted - the safe-deletion path (Phase 2)
-- must archive or reassign first. FK on VARCHAR auto-creates the needed index.
ALTER TABLE `users`      ADD CONSTRAINT `fk_users_bu` FOREIGN KEY (`business_unit`) REFERENCES `business_units` (`slug`) ON UPDATE CASCADE;
ALTER TABLE `leads`      ADD CONSTRAINT `fk_leads_bu` FOREIGN KEY (`business_unit`) REFERENCES `business_units` (`slug`) ON UPDATE CASCADE;
ALTER TABLE `global_pos` ADD CONSTRAINT `fk_gpos_bu`  FOREIGN KEY (`business_unit`) REFERENCES `business_units` (`slug`) ON UPDATE CASCADE;
