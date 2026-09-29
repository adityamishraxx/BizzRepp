// === JIOAUTIFY INTEGRATION: production / base-path flag, derived STRICTLY from NODE_ENV — mirrors
// Jio Inventory (src/env.js) and Release Planner. The STB backend serves this app under /sales_crm
// in production and at root in standalone dev.
//
// IMPORTANT: process.env.NODE_ENV is a BUILD-TIME value. It is 'production' only when the bundle is
// produced with `npm run build` (react-scripts forces NODE_ENV=production and folds these checks to
// constants). A `npm start` / dev bundle is 'development' — never serve a dev bundle under
// /sales_crm, or the basename will be '/' and routes like /sales_crm/login will bounce to the STB
// portal. Always deploy a `npm run build` output. ===
export const IS_PROD = process.env.NODE_ENV === 'production';
export const BASE_PATH = IS_PROD ? '/sales_crm' : '';
