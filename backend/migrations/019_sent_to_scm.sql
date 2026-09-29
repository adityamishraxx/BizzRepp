-- Migration 019 -- 'Sent to SCM' handoff tracking flag.
--
-- A purely MANUAL marker recording that a lead has been included in a forecast list shared with
-- the SCM team. Nothing in the app sets, clears or reacts to it automatically: changing a lead's
-- device quantity (or anything else) leaves the flag exactly as a user last set it. It is a shared
-- field on the lead, not a per-user marking, so everyone with forecast access sees the same state.
--
-- sent_to_scm_at / sent_to_scm_by denormalise "who last marked it and when" so the Forecast
-- Dashboard can show it without joining the activity log. The audit trail itself stays in
-- activity_log (see PATCH /api/forecast/devices/:id/sent-to-scm).
--
-- NOTE keep this file free of the semicolon character except the statement terminator, because the
-- migration runner splits statements on it.

ALTER TABLE `leads`
  ADD COLUMN `sent_to_scm`    tinyint(1)   NOT NULL DEFAULT 0 AFTER `device_requested_date`,
  ADD COLUMN `sent_to_scm_at` datetime     DEFAULT NULL       AFTER `sent_to_scm`,
  ADD COLUMN `sent_to_scm_by` varchar(255) DEFAULT NULL       AFTER `sent_to_scm_at`;
