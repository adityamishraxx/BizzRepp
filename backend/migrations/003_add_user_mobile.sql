-- Migration 003 — add a mobile contact number to users.
--
-- The Settings user add/edit modal collects email, name, mobile and role for every user. Mobile is
-- stored here. It is nullable so existing rows (created before this column existed) remain valid.
-- The app enforces it as mandatory for anything created or edited through the modal.

ALTER TABLE `users` ADD COLUMN `mobile` varchar(32) DEFAULT NULL AFTER `email`;
