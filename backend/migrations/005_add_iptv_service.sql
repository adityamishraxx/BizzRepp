-- Migration 005 -- IPTV service (JHES).
--
-- IPTV is an OPEX (recurring) service offered on JHES leads. It mirrors the other opex services
-- (Platform/CMS/Connectivity/AMC): an included flag plus a unit rate and quantity that feed the
-- auto-calculated TCV. Signage leads never tick it, so it contributes 0 to their TCV.
--
-- NOTE: keep this file free of the semicolon character except the final statement terminator,
-- because the migration runner splits statements on it.

ALTER TABLE `leads`
  ADD COLUMN `includes_iptv` tinyint(1)    DEFAULT '0'  AFTER `includes_installation`,
  ADD COLUMN `iptv_rate`     decimal(12,2) DEFAULT NULL AFTER `installation_rate`,
  ADD COLUMN `iptv_qty`      int           DEFAULT NULL AFTER `installation_qty`;
