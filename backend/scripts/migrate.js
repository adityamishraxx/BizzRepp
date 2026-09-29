// Applies pending .sql files from backend/migrations/, in filename order,
// tracking what's already run in a `schema_migrations` table. This is the
// authoritative schema mechanism — sequelize.sync() is NOT used.
//
// To add a schema change later: drop a new numbered file in migrations/
// (e.g. 002_add_lead_tag.sql) and run `npm run migrate` (also runs on boot).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sequelize = require('../config/database');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function getApplied() {
  const [rows] = await sequelize.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map(r => r.filename));
}

async function runMigrations({ silent = false } = {}) {
  await sequelize.authenticate();
  await ensureMigrationsTable();
  const applied = await getApplied();

  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  let ran = 0;

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    // Split on semicolons at statement boundaries (simple schema DDL, no stored procs).
    const statements = sql.split(';').map(s => s.trim()).filter(Boolean);

    const t = await sequelize.transaction();
    try {
      for (const stmt of statements) await sequelize.query(stmt, { transaction: t });
      await sequelize.query('INSERT INTO schema_migrations (filename) VALUES (?)', { replacements: [file], transaction: t });
      await t.commit();
      if (!silent) console.log(`  ✓ applied migration: ${file}`);
      ran++;
    } catch (err) {
      await t.rollback();
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }

  if (!silent) console.log(ran === 0 ? 'No pending migrations.' : `Applied ${ran} migration(s).`);
  return ran;
}

module.exports = { runMigrations };

// Allow `node scripts/migrate.js` standalone in addition to being imported by server.js
if (require.main === module) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(err => { console.error(err.message); process.exit(1); });
}
