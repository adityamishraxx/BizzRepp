require('dotenv').config();
const bcrypt = require('bcryptjs');
const { User, Setting, DropdownOption } = require('../models');
const { runMigrations } = require('./migrate');

const SIGNAGE_BDS = [
  { name: 'Hardik Bhagat', initials: 'HB', color: 'bg-violet-500',  sort_order: 1 },
  { name: 'Karan Amin',    initials: 'KA', color: 'bg-sky-500',     sort_order: 2 },
  { name: 'Mudit Singhal', initials: 'MS', color: 'bg-emerald-500', sort_order: 3 },
  { name: 'Rishab Mangal', initials: 'RM', color: 'bg-amber-500',   sort_order: 4 },
];
const JHES_BDS = [
  { name: 'Paras Soni', initials: 'PS', color: 'bg-orange-500', sort_order: 1 },
  { name: 'Samir Apte', initials: 'SA', color: 'bg-teal-500',   sort_order: 2 },
];
const SURVEILLANCE_BDS = [
  { name: 'Tushar Sarkar',  initials: 'TS', color: 'bg-rose-500',   sort_order: 1 },
  { name: 'Karuna Sagar',   initials: 'KS', color: 'bg-indigo-500', sort_order: 2 },
  { name: 'Somashekar MS',  initials: 'SM', color: 'bg-teal-500',   sort_order: 3 },
];

const SETTINGS_PLAIN = [
  { key_name: 'weekly_target_lakhs',   value: '5.3' },
  { key_name: 'bd_weekly_targets',     value: '{}' },
];
// Every BD starts on this password individually (own bcrypt-hashed row, not a
// shared secret) and is expected to change it after logging in.
const DEFAULT_BD_PASSWORD = '123456';

const DROPDOWNS = [
  ['phase', ['New', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'PO Expected', 'PO Received', 'Lost', 'On Hold']],
  ['lead_source', ['Channel Partner', 'KAM', 'Direct Sales', 'Lead Affiliate']],
  ['new_or_renewal', ['New', 'Renewal', 'Expansion']],
  ['lead_temperature', ['Hot', 'Warm', 'Cold']],
  // Signage channel partners — the Lead form shows these in a dropdown (with an "Other" option that
  // adds any new name here for future selections).
  ['channel_partner', [
    'Parshva Industria', 'Laser Av Solutions', 'Worldd AV', 'Acedk Select', 'Space Office Systems',
    'TimeNet Solutions', 'Annstech', 'Torrent Diagnostics Ltd.', 'Alkem',
    'Substance Infotech Solutions Pvt. Ltd', 'Bhumi World',
  ]],
];

(async () => {
  try {
    await runMigrations({ silent: true });

    // 1. PMO admin
    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
    let admin = await User.findOne({ where: { email: adminEmail } });
    if (!admin) {
      const hash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD || 'changeme', 10);
      admin = await User.create({
        name: process.env.SEED_ADMIN_NAME || 'PMO',
        email: adminEmail,
        password_hash: hash,
        role: 'super_admin',
        business_unit: process.env.SEED_ADMIN_BU || 'signage',
        initials: 'PM',
        color: 'bg-slate-700',
      });
      console.log(`✓ Admin created: ${adminEmail}`);
    } else {
      console.log(`⋯ Admin exists: ${adminEmail}`);
    }

    // 2. BDs — each gets their own bcrypt-hashed password, defaulting to
    // DEFAULT_BD_PASSWORD. Backfills any existing BD (created before this
    // change) that still has no password_hash.
    const defaultBdHash = await bcrypt.hash(DEFAULT_BD_PASSWORD, 10);
    let backfilled = 0;
    for (const bd of [...SIGNAGE_BDS.map(b => ({ ...b, business_unit: 'signage' })), ...JHES_BDS.map(b => ({ ...b, business_unit: 'jhes' })), ...SURVEILLANCE_BDS.map(b => ({ ...b, business_unit: 'surveillance' }))]) {
      const [user] = await User.findOrCreate({
        where: { name: bd.name, business_unit: bd.business_unit, role: 'bd' },
        defaults: { ...bd, role: 'bd', password_hash: defaultBdHash },
      });
      if (!user.password_hash) {
        user.password_hash = defaultBdHash;
        await user.save();
        backfilled++;
      }
    }
    console.log(`✓ BDs seeded (${SIGNAGE_BDS.length} signage, ${JHES_BDS.length} jhes)${backfilled ? ` — backfilled password for ${backfilled} existing BD(s)` : ''}, all default to "${DEFAULT_BD_PASSWORD}"`);

    // 3. Settings
    for (const s of SETTINGS_PLAIN) {
      await Setting.findOrCreate({ where: { key_name: s.key_name }, defaults: s });
    }
    console.log('✓ Settings seeded');

    // 4. Dropdowns — phase is global (workflow, not editable); the rest are per business, and
    // channel_partner belongs to Signage.
    const DROPDOWN_BUSINESSES = ['signage', 'jhes', 'surveillance'];
    const seedOption = (field, bu, value, i) => DropdownOption.findOrCreate({
      where: { field_name: field, business_unit: bu, value },
      defaults: { field_name: field, business_unit: bu, value, sort_order: i + 1, active: true },
    });
    for (const [field, values] of DROPDOWNS) {
      for (let i = 0; i < values.length; i++) {
        if (field === 'phase') await seedOption(field, null, values[i], i);
        else if (field === 'channel_partner') await seedOption(field, 'signage', values[i], i);
        else for (const bu of DROPDOWN_BUSINESSES) await seedOption(field, bu, values[i], i);
      }
    }
    // JHES-only partner lists (Channel Partner + Lead Affiliate). Gupta STS is both.
    const JHES_CHANNEL_PARTNERS = ['Mindlabz Hospitality', 'Star Hub ISO', 'Gupta STS - Indus Technologies', 'Treya Wireless Pvt Ltd', 'CTL Infocom Pvt Ltd'];
    const JHES_LEAD_AFFILIATES = ['Hospitality Sales and Marketing Company', 'MK Enterprises', 'Gupta STS - Indus Technologies', 'Amol Chauhan', 'Hotelogix', 'Hotelztech Solutions'];
    for (let i = 0; i < JHES_CHANNEL_PARTNERS.length; i++) await seedOption('channel_partner', 'jhes', JHES_CHANNEL_PARTNERS[i], i);
    for (let i = 0; i < JHES_LEAD_AFFILIATES.length; i++) await seedOption('lead_affiliate', 'jhes', JHES_LEAD_AFFILIATES[i], i);
    // Device SKUs — per business. JHES uses X2 / X4; signage & surveillance keep the legacy SKUs.
    const DEVICE_SKUS_DEFAULT = ['MCM3000', 'JSB210', 'J100', 'C2Av2', 'M2S'];
    for (let i = 0; i < DEVICE_SKUS_DEFAULT.length; i++) {
      await seedOption('device_sku', 'signage', DEVICE_SKUS_DEFAULT[i], i);
      await seedOption('device_sku', 'surveillance', DEVICE_SKUS_DEFAULT[i], i);
    }
    for (const [i, sku] of ['X2', 'X4'].entries()) await seedOption('device_sku', 'jhes', sku, i);
    console.log('✓ Dropdowns seeded');

    console.log('\nSeed complete.');
    process.exit(0);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exit(1);
  }
})();
