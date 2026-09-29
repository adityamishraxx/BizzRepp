-- Migration 009 -- Role hierarchy.
--
-- Five fixed roles replace the old set:
--   super_admin    global (cross-business) owner. Manages business units and assigns Business Admins.
--   business_admin business owner for one business. Assigns PMO / BD / Forecast within that business.
--   pmo            operational admin for one business. Can also add BDs.
--   bd             sales user. Owns their own leads.
--   forecast       Forecast dashboard for their business only.
--
-- The legacy 'admin' value is dropped (no rows use it). Promotion of the existing seed admin to
-- super_admin is handled by the seed script and a one-time data update, not here.
--
-- NOTE: keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `users`
  MODIFY COLUMN `role` enum('super_admin','business_admin','pmo','bd','forecast') NOT NULL DEFAULT 'bd';
