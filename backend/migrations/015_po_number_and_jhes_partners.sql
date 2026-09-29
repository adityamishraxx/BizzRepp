-- Migration 015 -- PO number identifier + JHES partner dropdowns.
--
-- Adds leads.po_number, captured once a PO document is attached at PO Received (an identifier for the
-- received PO). Seeds the JHES Channel Partner and Lead Affiliate dropdown lists from the supplied
-- partner roster (Gupta STS - Indus Technologies is both a Channel Partner and a Lead Affiliate, so it
-- appears in each list). PO validity is now derived from contract period in code -- no schema change.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `leads` ADD COLUMN `po_number` varchar(64) DEFAULT NULL AFTER `po_document_url`;

INSERT INTO `dropdown_options` (`field_name`, `business_unit`, `value`, `sort_order`, `active`) VALUES
  ('channel_partner','jhes','Mindlabz Hospitality',1,1),
  ('channel_partner','jhes','Star Hub ISO',2,1),
  ('channel_partner','jhes','Gupta STS - Indus Technologies',3,1),
  ('channel_partner','jhes','Treya Wireless Pvt Ltd',4,1),
  ('channel_partner','jhes','CTL Infocom Pvt Ltd',5,1),
  ('lead_affiliate','jhes','Hospitality Sales and Marketing Company',1,1),
  ('lead_affiliate','jhes','MK Enterprises',2,1),
  ('lead_affiliate','jhes','Gupta STS - Indus Technologies',3,1),
  ('lead_affiliate','jhes','Amol Chauhan',4,1),
  ('lead_affiliate','jhes','Hotelogix',5,1),
  ('lead_affiliate','jhes','Hotelztech Solutions',6,1);
