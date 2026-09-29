-- Migration 006 -- Lead affiliate (source name) + service period dates.
--
-- affiliate_name mirrors channel_partner_name / kam_name: it holds the affiliate's name when the
-- lead_source is "Lead Affiliate". service_start_date / service_end_date capture the contracted
-- service period, entered once a lead reaches PO Received.
--
-- NOTE: keep this file free of the semicolon character except the statement terminators, because the
-- migration runner splits statements on it.

ALTER TABLE `leads`
  ADD COLUMN `affiliate_name`     varchar(255) DEFAULT NULL AFTER `kam_name`,
  ADD COLUMN `service_start_date` date         DEFAULT NULL AFTER `po_received_date`,
  ADD COLUMN `service_end_date`   date         DEFAULT NULL AFTER `service_start_date`;
