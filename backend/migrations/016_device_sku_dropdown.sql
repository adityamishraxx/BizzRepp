-- Migration 016 -- Device SKU becomes a managed, per-business dropdown.
--
-- The device SKU list was a hardcoded global constant. It is now a per-business dropdown_options field
-- ('device_sku') so a PMO / Business Admin can add or remove SKUs per business. Signage and Surveillance
-- are seeded with the previous SKUs and JHES is seeded with only X2 and X4.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

INSERT INTO `dropdown_options` (`field_name`, `business_unit`, `value`, `sort_order`, `active`) VALUES
  ('device_sku','signage','MCM3000',1,1),
  ('device_sku','signage','JSB210',2,1),
  ('device_sku','signage','J100',3,1),
  ('device_sku','signage','C2Av2',4,1),
  ('device_sku','signage','M2S',5,1),
  ('device_sku','surveillance','MCM3000',1,1),
  ('device_sku','surveillance','JSB210',2,1),
  ('device_sku','surveillance','J100',3,1),
  ('device_sku','surveillance','C2Av2',4,1),
  ('device_sku','surveillance','M2S',5,1),
  ('device_sku','jhes','X2',1,1),
  ('device_sku','jhes','X4',2,1);
