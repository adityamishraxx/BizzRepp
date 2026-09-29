-- Migration 001 — initial schema
-- Generated from the live schema (matches models/index.js exactly at time of writing).
-- Created in FK-dependency order: users → leads → lead_contacts/activity_log/stage_history → settings/dropdown_options.

CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `role` enum('admin','pmo','bd') NOT NULL DEFAULT 'bd',
  `business_unit` enum('signage','jhes') NOT NULL DEFAULT 'signage',
  `initials` varchar(8) DEFAULT NULL,
  `color` varchar(32) DEFAULT 'bg-indigo-500',
  `active` tinyint(1) DEFAULT '1',
  `sort_order` int DEFAULT '0',
  `last_seen` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `leads` (
  `id` int NOT NULL AUTO_INCREMENT,
  `sr_no` int DEFAULT NULL,
  `customer_name` varchar(255) NOT NULL,
  `owner_id` int NOT NULL,
  `business_unit` enum('signage','jhes') NOT NULL DEFAULT 'signage',
  `city` varchar(255) DEFAULT NULL,
  `state` varchar(255) DEFAULT NULL,
  `lead_source` varchar(64) DEFAULT NULL,
  `channel_partner_name` varchar(255) DEFAULT NULL,
  `kam_name` varchar(255) DEFAULT NULL,
  `new_or_renewal` enum('New','Renewal','Expansion') DEFAULT NULL,
  `lead_temperature` enum('Hot','Warm','Cold') DEFAULT NULL,
  `competitor` varchar(255) DEFAULT NULL,
  `quantity` int DEFAULT '0',
  `potential_tcv_lakhs` decimal(12,2) DEFAULT NULL,
  `contract_period_months` int DEFAULT NULL,
  `po_validity_months` int DEFAULT NULL,
  `acv_lakhs` decimal(12,2) DEFAULT NULL,
  `contract_value_lakhs` decimal(12,2) DEFAULT NULL,
  `phase` varchar(32) DEFAULT 'New',
  `phase_changed_at` datetime DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `qualified_date` date DEFAULT NULL,
  `demo_date` date DEFAULT NULL,
  `proposal_date` date DEFAULT NULL,
  `negotiation_date` date DEFAULT NULL,
  `po_received_date` date DEFAULT NULL,
  `po_expected_date` date DEFAULT NULL,
  `next_followup_date` date DEFAULT NULL,
  `includes_platform` tinyint(1) DEFAULT '0',
  `includes_cms` tinyint(1) DEFAULT '0',
  `includes_connectivity` tinyint(1) DEFAULT '0',
  `includes_display` tinyint(1) DEFAULT '0',
  `includes_device` tinyint(1) DEFAULT '0',
  `device_sku` varchar(64) DEFAULT NULL,
  `device_requested_date` date DEFAULT NULL,
  `platform_rate` decimal(12,2) DEFAULT NULL,
  `cms_rate` decimal(12,2) DEFAULT NULL,
  `connectivity_rate` decimal(12,2) DEFAULT NULL,
  `display_rate` decimal(12,2) DEFAULT NULL,
  `device_rate` decimal(12,2) DEFAULT NULL,
  `platform_qty` int DEFAULT NULL,
  `cms_qty` int DEFAULT NULL,
  `connectivity_qty` int DEFAULT NULL,
  `display_qty` int DEFAULT NULL,
  `device_qty` int DEFAULT NULL,
  `jhes_product` varchar(255) DEFAULT NULL,
  `additional_notes` text,
  `po_document_url` varchar(512) DEFAULT NULL,
  `lost_reason` varchar(255) DEFAULT NULL,
  `po_actual_value_lakhs` decimal(12,2) DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `updated_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `sr_no` (`sr_no`),
  KEY `owner_id` (`owner_id`),
  CONSTRAINT `leads_ibfk_1` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `lead_contacts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `lead_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `phone` varchar(64) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `designation` varchar(128) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `lead_id` (`lead_id`),
  CONSTRAINT `lead_contacts_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `activity_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `lead_id` int NOT NULL,
  `lead_sr_no` int DEFAULT NULL,
  `customer_name` varchar(255) DEFAULT NULL,
  `user_name` varchar(255) DEFAULT NULL,
  `action_type` varchar(64) DEFAULT NULL,
  `field_changed` varchar(64) DEFAULT NULL,
  `old_value` text,
  `new_value` text,
  `note` text,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `lead_id` (`lead_id`),
  CONSTRAINT `activity_log_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `stage_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `lead_id` int NOT NULL,
  `from_stage` varchar(32) DEFAULT NULL,
  `to_stage` varchar(32) NOT NULL,
  `changed_by` varchar(255) NOT NULL,
  `changed_at` datetime NOT NULL,
  `notes` text,
  PRIMARY KEY (`id`),
  KEY `lead_id` (`lead_id`),
  CONSTRAINT `stage_history_ibfk_1` FOREIGN KEY (`lead_id`) REFERENCES `leads` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `settings` (
  `key_name` varchar(64) NOT NULL,
  `value` text NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`key_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `dropdown_options` (
  `id` int NOT NULL AUTO_INCREMENT,
  `field_name` varchar(64) NOT NULL,
  `value` varchar(128) NOT NULL,
  `sort_order` int DEFAULT '0',
  `active` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
