-- Migration 017 -- Account Mix (all businesses) + VOC module (Surveillance only).
--
-- Account Mix adds Property Type and Property Category to every lead. VOC (Voice of Customer) is a new
-- Surveillance-only module capturing customer feedback / feature gaps, with a full audit trail table.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `leads`
  ADD COLUMN `property_type`     varchar(32)  DEFAULT NULL AFTER `business_unit`,
  ADD COLUMN `property_category` varchar(64)  DEFAULT NULL AFTER `property_type`;

CREATE TABLE IF NOT EXISTS `vocs` (
  `id`                   int NOT NULL AUTO_INCREMENT,
  `voc_no`               int DEFAULT NULL,
  `business_unit`        varchar(32) NOT NULL DEFAULT 'surveillance',
  `date_of_entry`        date DEFAULT NULL,
  `customer_name`        varchar(255) NOT NULL,
  `opportunity_name`     varchar(255) DEFAULT NULL,
  `bd_owner_id`          int DEFAULT NULL,
  `pmo_owner`            varchar(255) DEFAULT NULL,
  `region_state`         varchar(255) DEFAULT NULL,
  `customer_segment`     varchar(64) DEFAULT NULL,
  `product_solution`     varchar(64) DEFAULT NULL,
  `voc_type`             varchar(64) DEFAULT NULL,
  `description`          text,
  `business_impact`      varchar(64) DEFAULT NULL,
  `revenue_impact_lakhs` decimal(14,2) DEFAULT NULL,
  `competitor`           varchar(255) DEFAULT NULL,
  `priority`             varchar(32) DEFAULT NULL,
  `attachment_url`       varchar(512) DEFAULT NULL,
  `status`               varchar(32) NOT NULL DEFAULT 'New',
  `product_remarks`      text,
  `target_release`       varchar(128) DEFAULT NULL,
  `closure_date`         date DEFAULT NULL,
  `created_by`           int DEFAULT NULL,
  `updated_by`           int DEFAULT NULL,
  `created_at`           datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`           datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_voc_no` (`voc_no`),
  KEY `idx_voc_bu` (`business_unit`),
  KEY `idx_voc_owner` (`bd_owner_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `voc_activity` (
  `id`            int NOT NULL AUTO_INCREMENT,
  `voc_id`        int NOT NULL,
  `user_name`     varchar(255) DEFAULT NULL,
  `action_type`   varchar(64) DEFAULT NULL,
  `field_changed` varchar(64) DEFAULT NULL,
  `old_value`     text,
  `new_value`     text,
  `note`          text,
  `created_at`    datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_voc_activity_voc` (`voc_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
