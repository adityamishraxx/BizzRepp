-- Migration 011 -- Per-business dropdown options.
--
-- Dropdown options (lead source, lead rating, new/renewal, channel partners, …) become scoped to a
-- business unit so each business manages its own lists. A NULL business_unit means a legacy/global
-- option (ignored once per-business options are seeded). Super Admin / Business Admin add & remove
-- options for their business from the lead form.
--
-- NOTE: keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `dropdown_options`
  ADD COLUMN `business_unit` varchar(32) DEFAULT NULL AFTER `field_name`;
