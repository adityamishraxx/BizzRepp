const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// --------------------------------------------------------------------------
// User — admins/PMOs and BDs live in the same table (role-based).
// Admins/PMOs have password_hash; BDs authenticate via the shared team
// password (settings.bd_default_password) and have password_hash = null.
// --------------------------------------------------------------------------
const User = sequelize.define('User', {
  id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name:          { type: DataTypes.STRING(255), allowNull: false },
  // email is unique PER business unit (composite key email_business_unit — see migration 002), so
  // one corporate email may hold both a signage and a jhes account. NULL emails (BDs) are exempt.
  email:         { type: DataTypes.STRING(255), unique: 'email_business_unit', allowNull: true },
  // mobile contact number. Nullable in the DB so pre-existing rows are unaffected; the Settings
  // add/edit modal makes it mandatory for users created or edited through the app.
  mobile:        { type: DataTypes.STRING(32), allowNull: true },
  password_hash: { type: DataTypes.STRING(255), allowNull: true },
  role:          { type: DataTypes.ENUM('super_admin', 'business_admin', 'pmo', 'bd', 'forecast'), allowNull: false, defaultValue: 'bd' },
  // business_unit is a slug FK into business_units (migration 029). Was an ENUM; now a plain
  // VARCHAR so a new business unit needs no DDL. Still part of the email_business_unit composite key.
  business_unit: { type: DataTypes.STRING(32), unique: 'email_business_unit', allowNull: false, defaultValue: 'signage' },
  initials:      { type: DataTypes.STRING(8) },
  color:         { type: DataTypes.STRING(32), defaultValue: 'bg-indigo-500' },
  active:        { type: DataTypes.BOOLEAN, defaultValue: true },
  // Grants access to the (now login-gated) Forecast dashboard. PMOs get it by default; a PMO can
  // grant it to any other user from Settings.
  forecast_access: { type: DataTypes.BOOLEAN, defaultValue: false },
  // Per-module access levels as JSON: { leads|dashboard|forecast|reports: none|read|edit|full }.
  // A second dimension alongside role and business_unit — see services/permissions.js. Null means
  // "never configured", in which case the role-derived default applies.
  module_permissions: { type: DataTypes.TEXT },
  // Cross-platform Super Admin grant (migration 021). NULL = not a super admin. 'read' = sees every
  // platform, changes nothing; 'write' = unrestricted everywhere. Additive to `role`, not a
  // replacement, so a platform PMO can also hold it.
  super_admin_scope: { type: DataTypes.ENUM('read', 'write') },
  // Platform-wide Activity feed grant (migration 025, J1/E4). Business Admin and Global Admin see
  // the feed by role; a Manager sees it only when this is set; a Team Member never does.
  activity_feed_access: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  sort_order:    { type: DataTypes.INTEGER, defaultValue: 0 },
  last_seen:     { type: DataTypes.DATE },
}, { tableName: 'users', underscored: true });

// --------------------------------------------------------------------------
// Lead
// --------------------------------------------------------------------------
const Lead = sequelize.define('Lead', {
  id:                      { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // sr_no is a human-facing sequence number, set by the app (max+1) on create —
  // MySQL only allows one AUTO_INCREMENT column per table, and `id` already is it.
  sr_no:                   { type: DataTypes.INTEGER, unique: true },
  customer_name:           { type: DataTypes.STRING(255), allowNull: false },
  owner_id:                { type: DataTypes.INTEGER, allowNull: false },
  // business_unit is a slug FK into business_units (migration 029) — was an ENUM, now VARCHAR.
  business_unit:           { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'signage' },
  // Account Mix — captured at the top of the lead form (all businesses).
  property_type:           { type: DataTypes.STRING(32) },   // Chain | Standalone | Other
  property_category:       { type: DataTypes.STRING(64) },   // Hotel | Hospital | BFSI | Retail | …
  // A lead is always an Individual (Local) PO — the funnel entity. Global POs live in global_pos, not
  // here. global_po_id is the nullable chain link (null = standalone property; see migration 014).
  po_type:                 { type: DataTypes.ENUM('individual', 'global'), allowNull: false, defaultValue: 'individual' },
  global_po_id:            { type: DataTypes.INTEGER },
  city:                    { type: DataTypes.STRING(255) },
  state:                   { type: DataTypes.STRING(255) },
  lead_source:             { type: DataTypes.STRING(64) },
  channel_partner_name:    { type: DataTypes.STRING(255) },
  kam_name:                { type: DataTypes.STRING(255) },
  affiliate_name:          { type: DataTypes.STRING(255) },
  new_or_renewal:          { type: DataTypes.ENUM('New', 'Renewal', 'Expansion') },
  lead_temperature:        { type: DataTypes.ENUM('Hot', 'Warm', 'Cold') },
  competitor:              { type: DataTypes.STRING(255) },
  quantity:                { type: DataTypes.INTEGER, defaultValue: 0 },
  potential_tcv_lakhs:     { type: DataTypes.DECIMAL(12, 2) },
  // true = potential_tcv_lakhs was typed by hand; false = auto-calculated from services ×
  // contract period. Defaults to true so pre-existing leads keep their manual TCV (see migration 004).
  tcv_manual:              { type: DataTypes.BOOLEAN, defaultValue: true },
  contract_period_months:  { type: DataTypes.INTEGER },
  po_validity_months:      { type: DataTypes.INTEGER },
  acv_lakhs:               { type: DataTypes.DECIMAL(12, 2) },
  contract_value_lakhs:    { type: DataTypes.DECIMAL(12, 2) },
  phase:                   { type: DataTypes.STRING(32), defaultValue: 'New' },
  phase_changed_at:        { type: DataTypes.DATE },
  // --- Lead Confidence Scoring (see backend/services/scoring.js + migration 013) ---
  // last_activity_at anchors the decay clock: SLA breaches are measured from the last touchpoint.
  last_activity_at:        { type: DataTypes.DATE },
  confidence_score:        { type: DataTypes.DECIMAL(5, 2) },   // current computed confidence (0-100)
  confidence_prev:         { type: DataTypes.DECIMAL(5, 2) },   // ~1-week-ago baseline for the trend arrow
  confidence_prev_at:      { type: DataTypes.DATE },
  confidence_computed_at:  { type: DataTypes.DATE },
  // On-Hold freeze: value captured at hold entry, when it began, the editable resume/end date, and the
  // stage to restore on manual resume (the pipeline stage never changes while On Hold).
  hold_frozen_confidence:  { type: DataTypes.DECIMAL(5, 2) },
  hold_entered_at:         { type: DataTypes.DATE },
  hold_end_date:           { type: DataTypes.DATEONLY },
  pre_hold_stage:          { type: DataTypes.STRING(32) },
  start_date:              { type: DataTypes.DATEONLY },
  qualified_date:          { type: DataTypes.DATEONLY },
  demo_date:               { type: DataTypes.DATEONLY },
  proposal_date:           { type: DataTypes.DATEONLY },
  negotiation_date:        { type: DataTypes.DATEONLY },
  po_received_date:        { type: DataTypes.DATEONLY },
  service_start_date:      { type: DataTypes.DATEONLY },
  service_end_date:        { type: DataTypes.DATEONLY },
  po_expected_date:        { type: DataTypes.DATEONLY },
  next_followup_date:      { type: DataTypes.DATEONLY },
  includes_platform:       { type: DataTypes.BOOLEAN, defaultValue: false },
  includes_cms:            { type: DataTypes.BOOLEAN, defaultValue: false },
  includes_connectivity:   { type: DataTypes.BOOLEAN, defaultValue: false },
  includes_display:        { type: DataTypes.BOOLEAN, defaultValue: false },
  includes_device:         { type: DataTypes.BOOLEAN, defaultValue: false },
  includes_amc:            { type: DataTypes.BOOLEAN, defaultValue: false },
  includes_installation:   { type: DataTypes.BOOLEAN, defaultValue: false },
  includes_iptv:           { type: DataTypes.BOOLEAN, defaultValue: false },
  includes_jhes:           { type: DataTypes.BOOLEAN, defaultValue: false },
  device_sku:              { type: DataTypes.STRING(64) },
  // Device cost nature is chosen per lead by the BD (all other services have a fixed nature).
  device_cost_type:        { type: DataTypes.ENUM('capex', 'opex') },
  device_requested_date:   { type: DataTypes.DATEONLY },
  // Manual 'Sent to SCM' handoff marker (migration 019). Shared state on the lead — not per-user —
  // and never set or cleared automatically by any other change.
  sent_to_scm:             { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  sent_to_scm_at:          { type: DataTypes.DATE },
  sent_to_scm_by:          { type: DataTypes.STRING(255) },
  platform_rate:           { type: DataTypes.DECIMAL(12, 2) },
  cms_rate:                { type: DataTypes.DECIMAL(12, 2) },
  connectivity_rate:       { type: DataTypes.DECIMAL(12, 2) },
  display_rate:            { type: DataTypes.DECIMAL(12, 2) },
  device_rate:             { type: DataTypes.DECIMAL(12, 2) },
  amc_rate:                { type: DataTypes.DECIMAL(12, 2) },
  installation_rate:       { type: DataTypes.DECIMAL(12, 2) },
  iptv_rate:               { type: DataTypes.DECIMAL(12, 2) },
  jhes_rate:               { type: DataTypes.DECIMAL(12, 2) },
  platform_qty:            { type: DataTypes.INTEGER },
  cms_qty:                 { type: DataTypes.INTEGER },
  connectivity_qty:        { type: DataTypes.INTEGER },
  display_qty:             { type: DataTypes.INTEGER },
  device_qty:              { type: DataTypes.INTEGER },
  amc_qty:                 { type: DataTypes.INTEGER },
  installation_qty:        { type: DataTypes.INTEGER },
  iptv_qty:                { type: DataTypes.INTEGER },
  jhes_qty:                { type: DataTypes.INTEGER },
  jhes_product:            { type: DataTypes.STRING(255) },
  additional_notes:        { type: DataTypes.TEXT },
  // Values of admin-defined CUSTOM fields (migration 031), keyed by field slug. Predefined/core
  // fields use their own columns; this holds only fields with no dedicated column, per business unit.
  custom_fields:           { type: DataTypes.JSON },
  // Surveillance-only: ticked services as JSON [{ label, nature, rate, qty }]. Null for signage/jhes,
  // which use their own per-service columns.
  services_json:           { type: DataTypes.TEXT },
  po_document_url:         { type: DataTypes.STRING(512) },
  // Identifier for the received PO — captured once a PO document is attached at PO Received.
  po_number:               { type: DataTypes.STRING(64) },
  lost_reason:             { type: DataTypes.STRING(255) },
  po_actual_value_lakhs:   { type: DataTypes.DECIMAL(12, 2) },
  created_by:              { type: DataTypes.INTEGER },
  updated_by:              { type: DataTypes.INTEGER },
}, { tableName: 'leads', underscored: true });

// --------------------------------------------------------------------------
// LeadContact
// --------------------------------------------------------------------------
const LeadContact = sequelize.define('LeadContact', {
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  lead_id:     { type: DataTypes.INTEGER, allowNull: false },
  name:        { type: DataTypes.STRING(255), allowNull: false },
  phone:       { type: DataTypes.STRING(64) },
  email:       { type: DataTypes.STRING(255) },
  designation: { type: DataTypes.STRING(128) },
}, { tableName: 'lead_contacts', underscored: true });

// --------------------------------------------------------------------------
// ActivityLog — every save/edit
// --------------------------------------------------------------------------
const ActivityLog = sequelize.define('ActivityLog', {
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // Nullable since migration 022: this table now records non-lead events too (chain / permissions /
  // SLA), which have no lead. Lead events still set it, so the per-lead Activity tab is unchanged.
  lead_id:        { type: DataTypes.INTEGER },
  // What kind of thing changed — the global feed's category tag.
  entity_type:    { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'lead' },
  // Id of that thing (chain id, target user id…). Mirrors lead_id for lead events.
  entity_id:      { type: DataTypes.INTEGER },
  // Platform the event belongs to. NULL = cross-platform (e.g. a Super Admin grant).
  business_unit:  { type: DataTypes.STRING(32) },
  lead_sr_no:     { type: DataTypes.INTEGER },
  customer_name:  { type: DataTypes.STRING(255) },
  // WHO made the change. user_name is the display name at the time; user_id is the durable
  // identity (names repeat and can be renamed) and user_email is what a reader recognises.
  user_name:      { type: DataTypes.STRING(255) },
  user_id:        { type: DataTypes.INTEGER },
  user_email:     { type: DataTypes.STRING(255) },
  action_type:    { type: DataTypes.STRING(64) },
  field_changed: { type: DataTypes.STRING(64) },
  old_value:      { type: DataTypes.TEXT },
  new_value:      { type: DataTypes.TEXT },
  note:           { type: DataTypes.TEXT },
}, { tableName: 'activity_log', underscored: true, updatedAt: false });

// --------------------------------------------------------------------------
// StageHistory — every phase move (powers funnel + rotting analytics)
// --------------------------------------------------------------------------
const StageHistory = sequelize.define('StageHistory', {
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  lead_id:    { type: DataTypes.INTEGER, allowNull: false },
  from_stage: { type: DataTypes.STRING(32) },
  to_stage:   { type: DataTypes.STRING(32), allowNull: false },
  changed_by: { type: DataTypes.STRING(255), allowNull: false },
  changed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  notes:      { type: DataTypes.TEXT },
}, { tableName: 'stage_history', underscored: true, updatedAt: false, createdAt: false });

// --------------------------------------------------------------------------
// Setting — key/value config (weekly target, per-BD targets, bd_default_password…)
// --------------------------------------------------------------------------
const Setting = sequelize.define('Setting', {
  key_name: { type: DataTypes.STRING(64), primaryKey: true },
  value:    { type: DataTypes.TEXT, allowNull: false },
}, { tableName: 'settings', underscored: true, createdAt: false });

// --------------------------------------------------------------------------
// GlobalPo — chain/account-level reference record (a hotel chain, etc). NOT a funnel entity: it has
// no stage and no confidence score. Individual (Local) POs (leads) link to it via leads.global_po_id.
// Consumed devices are DERIVED from linked leads at PO Received (see services/chainPool.js).
// --------------------------------------------------------------------------
const GlobalPo = sequelize.define('GlobalPo', {
  id:                  { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // business_unit is a slug FK into business_units (migration 029) — was an ENUM, now VARCHAR.
  business_unit:       { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'signage' },
  chain_name:          { type: DataTypes.STRING(255), allowNull: false },
  device_total:        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  price_lakhs:         { type: DataTypes.DECIMAL(14, 2) },
  expected_start_date: { type: DataTypes.DATEONLY },
  expected_end_date:   { type: DataTypes.DATEONLY },
  created_by:          { type: DataTypes.INTEGER },
  updated_by:          { type: DataTypes.INTEGER },
}, { tableName: 'global_pos', underscored: true });

// --------------------------------------------------------------------------
// Voc — Voice of Customer entry (Surveillance business only). Captures customer feedback / feature
// gaps / config mismatches found during sales & deployment, for product roadmap planning.
// --------------------------------------------------------------------------
const Voc = sequelize.define('Voc', {
  id:                   { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  voc_no:               { type: DataTypes.INTEGER, unique: true },
  business_unit:        { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'surveillance' },
  date_of_entry:        { type: DataTypes.DATEONLY },
  customer_name:        { type: DataTypes.STRING(255), allowNull: false },
  total_account_value_lakhs: { type: DataTypes.DECIMAL(14, 2) },
  bd_owner_id:          { type: DataTypes.INTEGER },
  pmo_owner:            { type: DataTypes.STRING(255) },
  region_state:         { type: DataTypes.STRING(255) },
  customer_segment:     { type: DataTypes.STRING(64) },
  product_solution:     { type: DataTypes.STRING(255) },   // multi-select, stored comma-separated
  voc_type:             { type: DataTypes.STRING(64) },
  description:          { type: DataTypes.TEXT },
  business_impact:      { type: DataTypes.STRING(64) },
  revenue_impact_lakhs: { type: DataTypes.DECIMAL(14, 2) },
  competitor:           { type: DataTypes.STRING(255) },
  priority:             { type: DataTypes.STRING(32) },
  attachment_url:       { type: DataTypes.STRING(512) },
  status:               { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'New' },
  product_remarks:      { type: DataTypes.TEXT },
  target_release:       { type: DataTypes.STRING(128) },
  closure_date:         { type: DataTypes.DATEONLY },
  created_by:           { type: DataTypes.INTEGER },
  updated_by:           { type: DataTypes.INTEGER },
}, { tableName: 'vocs', underscored: true });

// VocActivity — audit trail for a VOC (created / status change / field update / comment).
const VocActivity = sequelize.define('VocActivity', {
  id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  voc_id:        { type: DataTypes.INTEGER, allowNull: false },
  user_name:     { type: DataTypes.STRING(255) },
  action_type:   { type: DataTypes.STRING(64) },
  field_changed: { type: DataTypes.STRING(64) },
  old_value:     { type: DataTypes.TEXT },
  new_value:     { type: DataTypes.TEXT },
  note:          { type: DataTypes.TEXT },
}, { tableName: 'voc_activity', underscored: true, updatedAt: false });

// --------------------------------------------------------------------------
// SlaConfig — per-platform SLA (days) per pipeline stage. Only the SLA is platform-specific;
// base weights and hourglass jumps are fixed constants in backend/services/scoring.js.
// --------------------------------------------------------------------------
const SlaConfig = sequelize.define('SlaConfig', {
  id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_unit: { type: DataTypes.STRING(32), allowNull: false },
  stage:         { type: DataTypes.STRING(32), allowNull: false },
  sla_days:      { type: DataTypes.INTEGER, allowNull: false },
}, { tableName: 'sla_config', underscored: true });

// --------------------------------------------------------------------------
// DropdownOption — extensible dropdowns (phases, sources, ratings…)
// --------------------------------------------------------------------------
const DropdownOption = sequelize.define('DropdownOption', {
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  field_name: { type: DataTypes.STRING(64), allowNull: false },
  // Which business this option belongs to (per-business lists). Null = legacy/global.
  business_unit: { type: DataTypes.STRING(32) },
  value:      { type: DataTypes.STRING(128), allowNull: false },
  sort_order: { type: DataTypes.INTEGER, defaultValue: 0 },
  active:     { type: DataTypes.BOOLEAN, defaultValue: true },
}, { tableName: 'dropdown_options', underscored: true, timestamps: false });

// --------------------------------------------------------------------------
// BusinessUnit — first-class business unit (migration 028), replacing the former
// ENUM('signage','jhes','surveillance'). users/leads/global_pos.business_unit are
// slug FKs into this table, so a new BU needs no schema change. status gates
// login/new-records (active | disabled | archived).
// --------------------------------------------------------------------------
const BusinessUnit = sequelize.define('BusinessUnit', {
  id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  slug:          { type: DataTypes.STRING(32), allowNull: false, unique: true },
  name:          { type: DataTypes.STRING(128), allowNull: false },
  description:   { type: DataTypes.STRING(512) },
  color:         { type: DataTypes.STRING(32), allowNull: false, defaultValue: '#6366f1' },
  status:        { type: DataTypes.ENUM('active', 'disabled', 'archived'), allowNull: false, defaultValue: 'active' },
  owner_id:      { type: DataTypes.INTEGER },
  business_type: { type: DataTypes.STRING(64) },
  config:        { type: DataTypes.JSON },
  sort_order:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, { tableName: 'business_units', underscored: true });

// --------------------------------------------------------------------------
// ServiceDefinition — a business unit's "services offered" catalogue (migration 030). Replaces the
// hardcoded per-BU service lists (SIGNAGE_SERVICES / JHES_SERVICES / SURVEILLANCE_ITEMS) so the BU
// wizard can offer the union of what every unit sells, derived from data.
// --------------------------------------------------------------------------
const ServiceDefinition = sequelize.define('ServiceDefinition', {
  id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  business_unit: { type: DataTypes.STRING(32), allowNull: false },
  slug:          { type: DataTypes.STRING(64), allowNull: false },
  label:         { type: DataTypes.STRING(128), allowNull: false },
  nature:        { type: DataTypes.ENUM('opex', 'capex'), allowNull: false, defaultValue: 'opex' },
  sort_order:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  active:        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { tableName: 'service_definitions', underscored: true });

// --------------------------------------------------------------------------
// Associations
// --------------------------------------------------------------------------
Lead.belongsTo(User,          { foreignKey: 'owner_id',   as: 'owner' });
User.hasMany(Lead,             { foreignKey: 'owner_id',   as: 'leads' });

Lead.hasMany(LeadContact,      { foreignKey: 'lead_id',    as: 'contacts', onDelete: 'CASCADE' });
LeadContact.belongsTo(Lead,    { foreignKey: 'lead_id' });

Lead.hasMany(ActivityLog,      { foreignKey: 'lead_id',    as: 'activity', onDelete: 'CASCADE' });
ActivityLog.belongsTo(Lead,    { foreignKey: 'lead_id' });

Lead.hasMany(StageHistory,     { foreignKey: 'lead_id',    as: 'stageHistory', onDelete: 'CASCADE' });
StageHistory.belongsTo(Lead,   { foreignKey: 'lead_id' });

// Individual PO (lead) → Global PO (chain). onDelete SET NULL: removing a chain makes its properties
// standalone rather than cascading a delete.
Lead.belongsTo(GlobalPo,       { foreignKey: 'global_po_id', as: 'globalPo' });
GlobalPo.hasMany(Lead,         { foreignKey: 'global_po_id', as: 'individualPos', onDelete: 'SET NULL' });

Voc.belongsTo(User,            { foreignKey: 'bd_owner_id', as: 'bdOwner' });
Voc.hasMany(VocActivity,       { foreignKey: 'voc_id', as: 'activity', onDelete: 'CASCADE' });
VocActivity.belongsTo(Voc,     { foreignKey: 'voc_id' });

module.exports = {
  sequelize,
  BusinessUnit,
  ServiceDefinition,
  User,
  Lead,
  LeadContact,
  ActivityLog,
  StageHistory,
  Setting,
  DropdownOption,
  SlaConfig,
  GlobalPo,
  Voc,
  VocActivity,
};
