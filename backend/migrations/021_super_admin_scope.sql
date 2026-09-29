-- Migration 021 -- Cross-platform Super Admin, with a Read-only / Read+Write mode.
--
-- Adds users.super_admin_scope: NULL | 'read' | 'write'.
--   NULL   -> not a Super Admin (the overwhelming majority of users)
--   'read'  -> sees every platform's data, makes no changes anywhere
--   'write' -> unrestricted: every platform, every module, including Settings
--
-- This is a GRANT, not a role. It sits alongside users.role so it can be additive: a Signage PMO
-- can also hold cross-platform Super Admin without giving up their platform role. That also means
-- a new platform added later is automatically in scope -- nothing enumerates platforms.
--
-- The existing role='super_admin' accounts are seeded to 'write' so today's behaviour is preserved
-- exactly. The role value itself is left alone so nothing that reads it changes meaning.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `users`
  ADD COLUMN `super_admin_scope` enum('read','write') DEFAULT NULL AFTER `module_permissions`;

UPDATE `users` SET `super_admin_scope` = 'write' WHERE `role` = 'super_admin' AND `super_admin_scope` IS NULL;
