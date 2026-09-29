-- Migration 004 -- AMC + Installation services, per-lead device cost type, manual-TCV flag.
--
-- New services on a signage lead:
--   * AMC (Annual Maintenance Charge) is OPEX (recurring, billed over the contract term).
--   * Installation charge is CAPEX (one-time).
-- Device gains a per-lead cost nature (device_cost_type) that the BD chooses: CAPEX or OPEX.
-- Every other service has a fixed nature. Opex is platform/cms/connectivity/amc. Capex is
-- display/installation.
--
-- tcv_manual records whether potential_tcv_lakhs was typed by hand (1) or auto-calculated from
-- the services x contract period (0). It DEFAULTS TO 1 so every pre-existing lead keeps its
-- hand-entered TCV untouched. The app writes an explicit value (0 = auto) for leads created or
-- edited after this feature ships.
--
-- NOTE: keep this file free of the semicolon character except the final statement terminator,
-- because the migration runner splits statements on it.

ALTER TABLE `leads`
  ADD COLUMN `includes_amc`          tinyint(1)              DEFAULT '0'  AFTER `includes_device`,
  ADD COLUMN `includes_installation` tinyint(1)              DEFAULT '0'  AFTER `includes_amc`,
  ADD COLUMN `device_cost_type`      enum('capex','opex')    DEFAULT NULL AFTER `device_sku`,
  ADD COLUMN `amc_rate`              decimal(12,2)           DEFAULT NULL AFTER `device_rate`,
  ADD COLUMN `installation_rate`     decimal(12,2)           DEFAULT NULL AFTER `amc_rate`,
  ADD COLUMN `amc_qty`               int                     DEFAULT NULL AFTER `device_qty`,
  ADD COLUMN `installation_qty`      int                     DEFAULT NULL AFTER `amc_qty`,
  ADD COLUMN `tcv_manual`            tinyint(1)              DEFAULT '1'  AFTER `potential_tcv_lakhs`;
