-- Migration 012 -- JHES service line.
--
-- The JHES business offers a "JHES" service (OPEX), alongside IPTV and Device. It mirrors the other
-- opex services: an included flag plus a unit rate and quantity feeding the auto-calculated TCV.
-- (Distinct from the legacy jhes_product text column.)
--
-- NOTE: keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `leads`
  ADD COLUMN `includes_jhes` tinyint(1)    DEFAULT '0'  AFTER `includes_iptv`,
  ADD COLUMN `jhes_rate`     decimal(12,2) DEFAULT NULL AFTER `iptv_rate`,
  ADD COLUMN `jhes_qty`      int           DEFAULT NULL AFTER `iptv_qty`;
