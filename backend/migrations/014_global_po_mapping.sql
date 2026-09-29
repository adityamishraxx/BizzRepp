-- Migration 014 -- Global vs Individual PO mapping (chain-level PO structure & device allocation).
--
-- A Global PO is a chain/account reference record only -- it never enters the funnel and never gets a
-- stage or confidence score, so it lives in its OWN table (global_pos), completely separate from the
-- funnel-bearing leads table. An Individual (Local) PO is an ordinary lead that optionally links to a
-- Global PO via leads.global_po_id (null = standalone property). Consumed devices per chain are DERIVED
-- (summed from linked Individual POs that have reached PO Received) -- there is no stored decrement.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

CREATE TABLE IF NOT EXISTS `global_pos` (
  `id`                  int NOT NULL AUTO_INCREMENT,
  `business_unit`       enum('signage','jhes','surveillance') NOT NULL DEFAULT 'signage',
  `chain_name`          varchar(255) NOT NULL,
  `device_total`        int NOT NULL DEFAULT 0,
  `price_lakhs`         decimal(14,2) DEFAULT NULL,
  `expected_start_date` date DEFAULT NULL,
  `expected_end_date`   date DEFAULT NULL,
  `created_by`          int DEFAULT NULL,
  `updated_by`          int DEFAULT NULL,
  `created_at`          datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_global_pos_bu` (`business_unit`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- leads.po_type documents that a lead is an Individual PO (always 'individual' -- Global POs are not
-- leads). global_po_id is the nullable chain link (null = standalone). ON DELETE SET NULL so removing a
-- chain record simply makes its properties standalone rather than failing.
ALTER TABLE `leads`
  ADD COLUMN `po_type`      enum('individual','global') NOT NULL DEFAULT 'individual' AFTER `business_unit`,
  ADD COLUMN `global_po_id` int DEFAULT NULL AFTER `po_type`,
  ADD CONSTRAINT `fk_leads_global_po` FOREIGN KEY (`global_po_id`) REFERENCES `global_pos` (`id`) ON DELETE SET NULL;
