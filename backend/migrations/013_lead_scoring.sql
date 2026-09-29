-- Migration 013 -- Lead Confidence Scoring engine.
--
-- Adds per-lead scoring/decay tracking, the On-Hold freeze fields, and a per-platform SLA config
-- table. Base weights, hourglass jump values, the step-decay formula and the floor are FIXED
-- constants in code (backend/services/scoring.js) shared across all platforms -- only SLA-days-per
-- stage is stored here and editable per platform.
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `leads`
  ADD COLUMN `last_activity_at`       datetime      DEFAULT NULL AFTER `phase_changed_at`,
  ADD COLUMN `confidence_score`       decimal(5,2)  DEFAULT NULL AFTER `last_activity_at`,
  ADD COLUMN `confidence_prev`        decimal(5,2)  DEFAULT NULL AFTER `confidence_score`,
  ADD COLUMN `confidence_prev_at`     datetime      DEFAULT NULL AFTER `confidence_prev`,
  ADD COLUMN `confidence_computed_at` datetime      DEFAULT NULL AFTER `confidence_prev_at`,
  ADD COLUMN `hold_frozen_confidence` decimal(5,2)  DEFAULT NULL AFTER `confidence_computed_at`,
  ADD COLUMN `hold_entered_at`        datetime      DEFAULT NULL AFTER `hold_frozen_confidence`,
  ADD COLUMN `hold_end_date`          date          DEFAULT NULL AFTER `hold_entered_at`,
  ADD COLUMN `pre_hold_stage`         varchar(32)   DEFAULT NULL AFTER `hold_end_date`;

-- Seed the last-activity anchor for existing leads from the best timestamp we have.
UPDATE `leads` SET `last_activity_at` = COALESCE(`phase_changed_at`, `updated_at`, `created_at`) WHERE `last_activity_at` IS NULL;

CREATE TABLE IF NOT EXISTS `sla_config` (
  `id`            int NOT NULL AUTO_INCREMENT,
  `business_unit` varchar(32) NOT NULL,
  `stage`         varchar(32) NOT NULL,
  `sla_days`      int NOT NULL,
  `created_at`    datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_bu_stage` (`business_unit`, `stage`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed all three platforms with the document's default SLA table (PO Received is terminal - no SLA).
INSERT INTO `sla_config` (`business_unit`, `stage`, `sla_days`) VALUES
  ('signage','New',2),('signage','Qualified',5),('signage','Demo',7),('signage','Proposal',7),('signage','Negotiation',15),('signage','PO Expected',7),
  ('jhes','New',2),('jhes','Qualified',5),('jhes','Demo',7),('jhes','Proposal',7),('jhes','Negotiation',15),('jhes','PO Expected',7),
  ('surveillance','New',2),('surveillance','Qualified',5),('surveillance','Demo',7),('surveillance','Proposal',7),('surveillance','Negotiation',15),('surveillance','PO Expected',7);
