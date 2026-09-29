-- Migration 008 -- Forecast-only role.
--
-- Adds a third role, "forecast", to users. A forecast user can sign in only to the Forecast
-- dashboard (no Leads/Dashboard/Reports/Settings). PMOs create these accounts from Settings.
--
-- NOTE: keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `users`
  MODIFY COLUMN `role` enum('admin','pmo','bd','forecast') NOT NULL DEFAULT 'bd';
