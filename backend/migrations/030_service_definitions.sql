-- Dynamic Business Units, Phase 3 (metadata) - service catalogue.
-- Moves each business unit's "services offered" list out of frontend/backend code constants and into
-- a table, so the BU creation wizard can derive the UNION of services from what actually exists and a
-- service added to an existing unit later shows up in the wizard automatically. Seeded to exactly
-- mirror today's catalogues (Signage 6 + Device, JHES 2 + Device, Surveillance 12) so nothing changes
-- for the existing units. Keep this file free of semicolons except as statement terminators.

CREATE TABLE IF NOT EXISTS `service_definitions` (
  `id`            INT AUTO_INCREMENT PRIMARY KEY,
  `business_unit` VARCHAR(32) NOT NULL,
  `slug`          VARCHAR(64) NOT NULL,
  `label`         VARCHAR(128) NOT NULL,
  `nature`        ENUM('opex','capex') NOT NULL DEFAULT 'opex',
  `sort_order`    INT NOT NULL DEFAULT 0,
  `active`        TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_bu_service` (`business_unit`, `slug`),
  KEY `idx_svcdef_bu` (`business_unit`),
  CONSTRAINT `fk_svcdef_bu` FOREIGN KEY (`business_unit`) REFERENCES `business_units` (`slug`) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `service_definitions` (`business_unit`, `slug`, `label`, `nature`, `sort_order`) VALUES
  ('signage', 'platform',     'Platform',                          'opex',  1),
  ('signage', 'cms',          'CMS',                               'opex',  2),
  ('signage', 'connectivity', 'Connectivity',                      'opex',  3),
  ('signage', 'amc',          'AMC (Annual Maintenance Charge)',   'opex',  4),
  ('signage', 'display',      'Display',                           'capex', 5),
  ('signage', 'installation', 'Installation Charge (one-time)',    'capex', 6),
  ('signage', 'device',       'Device',                            'opex',  7);

INSERT INTO `service_definitions` (`business_unit`, `slug`, `label`, `nature`, `sort_order`) VALUES
  ('jhes', 'jhes',   'JHES',   'opex', 1),
  ('jhes', 'iptv',   'IPTV',   'opex', 2),
  ('jhes', 'device', 'Device', 'opex', 3);

INSERT INTO `service_definitions` (`business_unit`, `slug`, `label`, `nature`, `sort_order`) VALUES
  ('surveillance', 'jiosecure_platform',         'JioSecure Platform',          'opex',  1),
  ('surveillance', 'jio_bridge_device',          'Jio Bridge Device',           'capex', 2),
  ('surveillance', 'jiosecure_cloud_storage',    'JioSecure Cloud Storage',     'opex',  3),
  ('surveillance', 'continuous_recording',       'Continuous Recording',        'opex',  4),
  ('surveillance', 'event_based_recording',      'Event Based Recording',       'opex',  5),
  ('surveillance', 'jio_cameras',                'Jio Cameras',                 'capex', 6),
  ('surveillance', 'jiosecure_analytics_suite',  'JioSecure Analytics Suite',   'opex',  7),
  ('surveillance', 'jsl_platform',               'JSL Platform',                'opex',  8),
  ('surveillance', 'jsl_devices',                'JSL Devices',                 'capex', 9),
  ('surveillance', 'jsl_cloud_storage',          'JSL Cloud Storage',           'opex',  10),
  ('surveillance', 'jio_smart_shop_shutter_kit', 'Jio Smart Shop (Shutter Kit)','capex', 11),
  ('surveillance', 'jio_smart_shop_subscription','Jio Smart Shop Subscription', 'opex',  12);
