-- Migration 020 -- Per-module access levels (RBAC).
--
-- Adds users.module_permissions: a JSON map of module -> level, e.g.
--   {"leads":"full","dashboard":"read","forecast":"edit","reports":"none"}
-- Levels are none | read | edit | full. A module missing from the map reads as 'none', so any
-- module added in future is denied to every existing user until explicitly granted.
--
-- This LAYERS ON TOP OF the existing role + business_unit model rather than replacing it. Both
-- checks must pass, so a permission can only ever narrow what a role already allowed -- e.g. a BD
-- granted 'full' on Leads still sees only their own leads and still cannot delete, because those
-- limits come from the role. Settings is deliberately NOT a module here: it stays role-gated to
-- super_admin / business_admin / pmo.
--
-- The UPDATE below seeds every existing user from their current effective access so nobody gains
-- or loses anything on rollout:
--   admin tier (super_admin/business_admin/pmo) -> full everywhere (matches AdminRoute today)
--   forecast accounts                           -> forecast only, 'edit' so they keep the
--                                                  Sent-to-SCM tick they already have
--   BD with forecast_access                     -> leads full, dashboard read, forecast edit
--   BD without                                  -> leads full, dashboard read, no forecast
-- BDs get 'full' rather than 'edit' on Leads because they can already create leads today, and
-- 'edit' excludes create. Delete stays blocked for them by the role check, not by this level.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `users`
  ADD COLUMN `module_permissions` text DEFAULT NULL AFTER `forecast_access`;

UPDATE `users` SET `module_permissions` = CASE
  WHEN `role` IN ('super_admin', 'business_admin', 'pmo')
    THEN '{"leads":"full","dashboard":"full","forecast":"full","reports":"full"}'
  WHEN `role` = 'forecast'
    THEN '{"leads":"none","dashboard":"none","forecast":"edit","reports":"none"}'
  WHEN `forecast_access` = 1
    THEN '{"leads":"full","dashboard":"read","forecast":"edit","reports":"none"}'
  ELSE '{"leads":"full","dashboard":"read","forecast":"none","reports":"none"}'
END WHERE `module_permissions` IS NULL;
