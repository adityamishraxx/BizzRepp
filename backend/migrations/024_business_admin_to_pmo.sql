-- Migration 024 -- Fold the legacy 'business_admin' role into 'pmo'.
--
-- The role vocabulary is now Global Admin (super_admin) / PMO / BD. business_admin was a
-- platform-scoped admin, functionally identical to a PMO, so its accounts become PMOs. The enum
-- value is left in place (harmless once unused) to avoid a riskier ENUM alteration.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

UPDATE `users` SET `role` = 'pmo' WHERE `role` = 'business_admin';
