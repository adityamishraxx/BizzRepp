const path = require('path');
const { Sequelize } = require('sequelize');

// === JIOAUTIFY INTEGRATION: read THIS app's own DB creds from its .env `.parsed` object, NOT from
// process.env. When mounted inside the STB backend, process.cwd() is the STB root AND the STB has
// already populated process.env with ITS OWN DB_* vars; dotenv.config() does not override existing
// process.env, so reading process.env.DB_NAME here would connect to the STB database instead of
// sales_crm. Loading the parsed .env by absolute __dirname path isolates Sales CRM's DB config in
// both standalone (dev) and mounted (prod) modes. Mirrors JIOINVENTORY/server/server.js and
// RELEASEPLANNER/backend/db.js. ===
const env = require('dotenv').config({ path: path.join(__dirname, '..', '.env') }).parsed || {};

const sequelize = new Sequelize(
  env.DB_NAME || 'sales_crm',
  env.DB_USER || 'root',
  env.DB_PASSWORD || '',
  {
    host: env.DB_HOST || 'localhost',
    port: Number(env.DB_PORT) || 3306,
    dialect: 'mysql',
    logging: false,
    pool: { max: 10, min: 0, idle: 10000, acquire: 30000 },
    define: { timestamps: true, underscored: false },
  }
);

module.exports = sequelize;
