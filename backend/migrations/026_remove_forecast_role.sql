-- Migration 026 -- N3: Fold the standalone Forecast role into the regular user model.
--
-- The one forecast account (id 43, Mohit Rajani, surveillance) becomes a Team Member with
-- Forecast read access via module_permissions. No one loses access -- the module access
-- replaces the role-based grant.

UPDATE `users`
SET `role` = 'bd',
    `module_permissions` = '{"leads":"full","dashboard":"read","forecast":"read","reports":"none"}'
WHERE `id` = 43 AND `role` = 'forecast';
