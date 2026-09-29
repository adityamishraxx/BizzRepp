-- Dynamic Business Units, Phase 1 (foundation).
-- Introduces a first-class business_units table to replace the hardcoded
-- ENUM('signage','jhes','surveillance') that lived on users/leads/global_pos.
-- This migration only CREATES and SEEDS the table. Migration 029 switches the
-- three ENUM columns to VARCHAR and points foreign keys at business_units(slug).
-- Keep this file free of semicolons except as statement terminators (the
-- migration runner splits on them).

CREATE TABLE IF NOT EXISTS `business_units` (
  `id`            INT AUTO_INCREMENT PRIMARY KEY,
  `slug`          VARCHAR(32) NOT NULL,
  `name`          VARCHAR(128) NOT NULL,
  `description`   VARCHAR(512) DEFAULT NULL,
  `color`         VARCHAR(32) NOT NULL DEFAULT '#6366f1',
  `status`        ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
  `owner_id`      INT DEFAULT NULL,
  `business_type` VARCHAR(64) DEFAULT NULL,
  `config`        JSON DEFAULT NULL,
  `sort_order`    INT NOT NULL DEFAULT 0,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_bu_slug` (`slug`),
  KEY `idx_bu_status` (`status`),
  CONSTRAINT `fk_bu_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed the three business units that currently exist as ENUM values. slug values
-- match the exact strings already stored in users/leads/global_pos so migration
-- 029 can add the foreign keys with zero data changes. Labels/colours/descriptions
-- mirror the frontend BU_CONFIG so nothing changes visually.
INSERT INTO `business_units` (`slug`, `name`, `description`, `color`, `status`, `sort_order`) VALUES
  ('signage',      'Signage',      'Digital Signage Solutions',                 '#4f46e5', 'active', 1),
  ('jhes',         'JHES',         'Jio Hospitality & Entertainment Services',  '#ea580c', 'active', 2),
  ('surveillance', 'Surveillance', 'Surveillance & Security Solutions',         '#0891b2', 'active', 3);
