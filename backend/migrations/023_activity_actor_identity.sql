-- Migration 023 -- Record WHO made each change, not just a display name.
--
-- activity_log only stored user_name, a free-text copy of users.name. That is not enough to
-- identify a person: several accounts share a name ("PMO" is both the signage super_admin and the
-- jhes PMO, under the same email), and renaming a user silently rewrites what history appears to
-- say. Storing the account id and email alongside the name fixes both -- the id is the durable
-- identity, the email is what a reader recognises.
--
-- Backfill matches on (user_name, business_unit), which resolves the duplicate "PMO" rows
-- correctly: signage events map to the signage account, jhes events to the jhes one. Rows that
-- stay ambiguous keep a NULL user_id and still display their original name.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `activity_log`
  ADD COLUMN `user_id`    int          DEFAULT NULL AFTER `user_name`,
  ADD COLUMN `user_email` varchar(255) DEFAULT NULL AFTER `user_id`;

UPDATE `activity_log` a JOIN `users` u ON u.name = a.user_name AND u.business_unit = a.business_unit SET a.user_id = u.id, a.user_email = u.email WHERE a.user_id IS NULL;

UPDATE `activity_log` a JOIN `users` u ON u.name = a.user_name SET a.user_id = u.id, a.user_email = u.email WHERE a.user_id IS NULL AND (SELECT COUNT(*) FROM `users` x WHERE x.name = a.user_name) = 1;

CREATE INDEX `idx_activity_user` ON `activity_log` (`user_id`);
