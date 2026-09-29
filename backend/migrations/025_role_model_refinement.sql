-- Migration 025 -- Role-model refinement (Themes E3/E4/E5, J1).
--
-- The role vocabulary is now: Global Admin (super_admin + grant), Business Admin (business_admin),
-- Manager (pmo), Team Member (bd). DB role values are kept -- only labels and grant rules change in
-- code. Two things happen here.
--
--   1. Restore the two accounts that were Business Admins before migration 024 folded them into
--      pmo. Business Admin is a distinct role again -- fixed full access on one platform.
--
--   2. Add activity_feed_access -- the platform-wide Activity feed is now a SEPARATE grant for
--      Managers (J1/E4). A Manager sees the global feed only if granted it, a Business Admin/Global
--      Admin see it automatically by role, and a Team Member never sees it. Existing Managers are
--      seeded to 1 so no one loses the feed they have today.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `users` ADD COLUMN `activity_feed_access` tinyint(1) NOT NULL DEFAULT 0 AFTER `super_admin_scope`;

UPDATE `users` SET `role` = 'business_admin' WHERE `id` IN (35, 41);

UPDATE `users` SET `activity_feed_access` = 1 WHERE `role` = 'pmo';
