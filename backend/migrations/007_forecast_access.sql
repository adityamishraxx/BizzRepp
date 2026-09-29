-- Migration 007 -- Forecast dashboard access flag.
--
-- The Forecast dashboard now requires login. Every PMO/admin gets access by default. A PMO can grant
-- access to any other user (for example a BD) from Settings, driven by this forecast_access flag.
--
-- NOTE: keep this file free of the semicolon character except the statement terminators, because the
-- migration runner splits statements on it.

ALTER TABLE `users`
  ADD COLUMN `forecast_access` tinyint(1) NOT NULL DEFAULT '0' AFTER `active`;

UPDATE `users` SET `forecast_access` = 1 WHERE `role` IN ('pmo', 'admin');
