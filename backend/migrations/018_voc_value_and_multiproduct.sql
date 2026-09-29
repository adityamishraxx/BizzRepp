-- Migration 018 -- VOC field tweaks (Surveillance).
--
-- Opportunity / Account name is replaced by a numeric Total Account Value (in lakhs). Product / Solution
-- becomes a multi-select stored as a comma-separated list, so its column is widened.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `vocs`
  ADD COLUMN `total_account_value_lakhs` decimal(14,2) DEFAULT NULL AFTER `customer_name`,
  MODIFY COLUMN `product_solution` varchar(255) DEFAULT NULL;
