# BizzRepp

### The Unified Lead-to-Cash Command Center for Multi-Vertical Enterprises

BizzRepp runs the **complete commercial lifecycle for hardware-plus-service bundles** on a single backbone — unifying **Lead-to-Order (L2O)**, **Order-to-Delivery (O2D)**, and **Delivery-to-Cash (D2C)** into one source of truth. It's architected to flex across multiple verticals — connectivity, digital signage, surveillance — on a single data model, so pipeline, fulfillment, and revenue never drift apart across spreadsheets and disconnected tools.

*An independent product & program management build — conceived and architected by Aditya Mishra.*

---

## The problem it solves

Commercial teams selling bundled hardware and services lose money to **fragmentation**:

- **Disconnected data** — pipeline stages hidden across spreadsheets no one trusts.
- **Tribal forecasting** — deals prioritized on intuition instead of live metrics.
- **Handoff gaps** — fulfillment details living outside the CRM, so what sales sold and what delivery installs quietly diverge.

BizzRepp closes all three by putting the entire lead-to-cash journey on one governed data model with server-enforced rules.

## The core journey — Lead to Cash

| Stage | | What it does |
|---|---|---|
| **1 · L2O** | Lead-to-Order | Confidence scores and total contract value rank leads, so effort follows the deals most likely to close. |
| **2 · O2D** | Order-to-Delivery | SLA-aware phased installation batches keep multi-site rollouts on track and on time. |
| **3 · D2C** | Delivery-to-Cash | Total contract value rolls up automatically the moment a site goes live. |

---

## Architecture

A three-tier, fully self-hosted stack — no dependency on any external hosted database.

- **Frontend** — React 18 SPA (Create React App), react-router-dom v6, axios, Context API, Recharts
- **Backend** — Node.js + Express 4, Sequelize 6 (MySQL), JWT + bcryptjs, multer
- **Database** — MySQL (self-hosted)

---

## Local development

### Prerequisites
- Node.js 18+
- MySQL 8+ running locally (or accessible over the network)

### 1) Database
```sql
CREATE DATABASE bizzrepp CHARACTER SET utf8mb4;
```
Schema is created by **versioned SQL migration files** in `backend/migrations/`, tracked in a `schema_migrations` table — `sequelize.sync()` is **not** used. Migrations run automatically on `npm run dev`/`start`/`seed`, or standalone via `npm run migrate`. To change the schema later, add a new numbered file (`002_xxx.sql`) — never edit `001_initial_schema.sql` after it's been applied anywhere.

### 2) Backend
```bash
cd backend
cp .env.example .env       # edit DB creds, JWT_SECRET, SEED_ADMIN_*
npm install
npm run seed               # runs migrations, then creates the admin + team + settings + dropdowns
npm run dev                # nodemon on http://localhost:4000
```

Health check: `curl http://localhost:4000/api/health`

### 3) Frontend
```bash
cd frontend
npm install
npm start                  # CRA on http://localhost:3000 (proxies /api → 4000)
```

Open http://localhost:3000 → pick a business unit → pick a person → sign in.
- **Admin:** `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` from `backend/.env`.
- **Team members:** each has an individual password, seeded to `123456`. They change it themselves under **Password** in the sidebar after logging in. An admin sees a new member's starting password once, in the confirmation message when adding them under **Settings**.

> **Note for Windows/CRA users:** if `npm start` fails with `options.allowedHosts[0] should be a non-empty string`, your machine has no detectable LAN IP (common in sandboxed/VM environments). Fix with:
> `set HOST=localhost&& set DANGEROUSLY_DISABLE_HOST_CHECK=true&& npm start`
> (PowerShell: `$env:HOST='localhost'; $env:DANGEROUSLY_DISABLE_HOST_CHECK='true'; npm start`).
> This should **not** be needed on a normal developer laptop or the production server.

---

## Production deploy

### Backend
```bash
cd backend
npm install --production
cp .env.example .env   # fill in real DB creds + a strong JWT_SECRET
```
Run under a process manager so it survives reboots/crashes:
```bash
npm install -g pm2
pm2 start server.js --name bizzrepp-api
pm2 save
pm2 startup   # follow the printed instructions to enable on boot
```
Or as a systemd unit (`/etc/systemd/system/bizzrepp-api.service`):
```ini
[Unit]
Description=BizzRepp API
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/bizzrepp/backend
ExecStart=/usr/bin/node server.js
Restart=always
EnvironmentFile=/opt/bizzrepp/backend/.env
User=www-data

[Install]
WantedBy=multi-user.target
```

### Frontend
```bash
cd frontend
npm install
npm run build     # outputs static files to frontend/build/
```
`build/` is a static bundle — no Node process needed for the frontend itself, just a web server (nginx below) serving the files.

### nginx reverse proxy
Put both behind one nginx vhost so the browser only ever talks to one origin (avoids CORS entirely):

```nginx
server {
    listen 80;
    server_name bizzrepp.yourcompany.internal;

    # React static build
    root /opt/bizzrepp/frontend/build;
    index index.html;
    location / {
        try_files $uri /index.html;   # SPA fallback for react-router
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Uploaded PO documents
    location /uploads/ {
        proxy_pass http://127.0.0.1:4000;
    }

    client_max_body_size 25m;   # PO document uploads are capped at 20MB server-side
}
```
Add TLS with certbot (`certbot --nginx -d bizzrepp.yourcompany.internal`) once DNS points here.

### Database
- Point `backend/.env` at your production MySQL instance (a managed instance or a separate DB server — not the same box as the API, ideally).
- Take regular `mysqldump` backups; the schema has no destructive migrations, so a nightly dump is sufficient for most teams.
- Run `npm run seed` **once** against production to create the initial admin + team roster + default settings, then manage the team from the Settings page from then on.

### Environment variable reference (backend/.env)
| Variable | Purpose |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL connection |
| `PORT` | API port (nginx proxies to this) |
| `JWT_SECRET` | **Change this in production** — long random string |
| `JWT_EXPIRES_IN` | Session length, default `8h` |
| `UPLOAD_DIR` | Folder for PO documents, default `uploads` (back this up too) |
| `SEED_ADMIN_EMAIL/PASSWORD/NAME/BU` | Only used once by `npm run seed` |

The frontend needs no `.env` in production if served from the same nginx origin as the API (relative `/api` calls just work). If frontend and backend are on different domains, set `REACT_APP_API_BASE` at build time.

---

## Capabilities

BizzRepp covers the full commercial lifecycle end to end:

- **Leads (L2O)** — table + Kanban (drag-and-drop phase change), search, multi-filter (phase/rating/source/owner), bulk reassign/phase-change, **Excel + PDF export**
- **Lead form** — full field set in a guided order (Lead Info → Competitor → **Services** with per-service rate + qty → Deal Size incl. **PO Validity** → Phase & Timeline with **±2-day phase-date editing** → Contacts → PO upload → **rich-text Notes**)
- **Owner data isolation enforced server-side** — each owner's SQL queries are scoped to `owner_id = self` in the API layer, not just hidden in the UI
- **Activity log** — every field change recorded per-lead, with numeric-aware diffing (no false positives on re-saved decimals)
- **Stage history** — every phase transition recorded, powering:
  - **Conversion funnel** (leads reached per stage + conversion % between stages)
  - **Bottleneck view** (avg days spent per stage)
  - **Rotting-deal badges** (stuck > 2× the team average for that stage)
- **Weighted forecast** (Σ TCV × stage win-probability) alongside raw open pipeline
- **Dashboard** — KPIs, leads-by-phase chips, weekly target (global + per-owner, admin-editable), annual performance (scoped: owners see only their own, admin sees all), overdue ticker, renewal alerts, **Data Quality panel** (flags leads missing TCV/quantity/follow-up)
- **Forecast Dashboard (O2D)** — **public, no login**, hardware units by month × SKU + detail table with Device Requested Date + Excel/PDF export
- **Reports** — full filter panel (date range, owner, phase, source, renewal type, services, state, PO-expected month) + Excel/PDF export
- **Settings** — admins add/remove team members and reset any member's password; each new member gets an individual starting password
- **Change Password** — self-serve for every account
- **Collapsible sidebar**, remembered across sessions

## Why it's built the way it is

1. **Real data isolation** — enforced in SQL `WHERE` clauses server-side, closing the security gap of UI-only enforcement.
2. **Business logic centralized in the backend** — quantity totals, ACV, phase-date clamping, and follow-up defaults are computed once, server-side, so the frontend can never drift from the rules or bypass them.
3. **Full self-hosting** — no external hosted database; runs entirely on your own MySQL + Node infrastructure.
4. **Version-controlled SQL schema** — `backend/migrations/*.sql` is the single source of truth, tracked in `schema_migrations`. No implicit schema creation via ORM sync.
5. **bcrypt everywhere passwords are checked** — every account is bcrypt-hashed; no plaintext password is ever stored, including in the seed script. Each member changes their own password independently — no shared secret to leak or rotate for the whole team.

### Build rigor

Delivered end to end — discovery, specification, build, and edge-case testing — as **13 themes and 30+ user stories shipped** under a single owner spanning Product and Program Management. Notable bugs caught during build-time testing, before they'd have reached a user:

- **Timezone bug**: date-only fields (`start_date`, `next_followup_date`, phase-date clamping) rolled back one calendar day on any server running ahead of UTC (e.g. **IST**). Fixed by doing all date-only math in local calendar fields, never round-tripping through `toISOString()`.
- **False-positive activity log**: MySQL's fixed-format `DECIMAL` strings (`"12.50"`) were compared against plain JS numbers (`12.5`), logging "changed" on values that hadn't changed. Fixed with a numeric-aware comparison.
- **Two Sequelize model bugs**: `Lead` originally had two `AUTO_INCREMENT` columns (`id` and `sr_no`) — MySQL allows only one; `sr_no` is now app-assigned.

All found via live testing against a real MySQL database (create → update → isolation → admin-permission → upload → delete → password rotation), run through the actual UI and a from-scratch DB rebuild — not just reasoned about.

### On the roadmap
- **Predictive analytics** to flag at-risk deals *before* an SLA breach.
- **Expanded audit suite** into a BI-grade command center.

---

## Rich-text editing & PDF export

- **Rich-text editing** (`react-quill`) — the Lead form's **Additional Notes** field supports bold/italic/underline, lists, and links. Stored as HTML in `leads.additional_notes`. Excel/PDF exports strip the HTML to clean plain text via a shared `stripHtml()` helper, so formatting never leaks into exported cells.
- **PDF export** (`jspdf` + `jspdf-autotable`) — every page with Excel export (**Leads**, **Reports**, **Forecast**) has a matching **Export PDF** button via one shared `exportRowsToPdf()` utility. PDF tables use a curated, readable column set (full detail stays in Excel; PDF is a quick printable summary). Forecast's PDF includes both the pivot and detail tables, matching its two-sheet Excel export.

Both verified against real generated output: the PDF export was checked by capturing the actual `Blob` before download and confirming non-trivial file size (~7–10KB); the rich-text → Excel pipeline by parsing the exported `.xlsx` blob back and confirming the notes cell contains clean stripped text, not raw HTML.

---

## Engineering conventions

**Backend**
- CommonJS (`require`), plain JavaScript.
- One Sequelize instance in `config/database.js`, env-driven.
- All models + associations in `models/index.js`. Model = PascalCase, table = snake_plural, columns = snake_case (`underscored: true`), integer PK.
- Route handlers are `async (req, res)` with `try { ... } catch (err) { res.status(500).json({ message: err.message }); }`. Successes = bare model/array; errors = `{ message }`. Status codes: 400 validation, 401 auth, 403 forbidden, 404 not found, 409 conflict, 201 create.
- `authenticate` reads `Authorization: Bearer <token>`, `jwt.verify`, loads user (password excluded), rejects inactive, stamps `last_seen`.
- JWT payload minimal: `{ id, role }`. Secret from `JWT_SECRET`, ~8h expiry.

**Frontend**
- CRA + plain JavaScript, ESM (`import`).
- ONE `axios.create({ baseURL: '/api' })` in `services/api.js`. Request interceptor attaches Bearer from `localStorage.Token`; response interceptor bounces to `/login` on 401. Every endpoint is a named arrow function grouped by resource; pages import these, never call axios directly.
- `AuthContext` exposes `user`, `login`, `logout`, plus permission predicates (`isAdmin`, `isBD`) consumed via `useAuth()`.
- Route guards: `PrivateRoute`, `AdminRoute`.
- No CSS framework — one global stylesheet string (`globalStyles.js`) injected once in `App.jsx`, defining utility classes (`.btn`, `.card`, `.input`, `.badge`, `.data-table`, `.modal`…); components use inline `style={{...}}` for the rest.

**Naming**
- Backend files/routers: `camelCase.js`; API paths: `kebab-case` (`/api/activity-log`).
- DB: `snake_case` tables (plural), `snake_case` columns. Models `PascalCase`.
- Frontend: `PascalCase.jsx` for pages/components (`LoginPage.jsx`), `camelCase.js` for services/utils. Contexts under `context/`, exposed via `use<Name>()` hooks.

---

## Project layout
```
bizzrepp/
├── backend/
│   ├── server.js              # boot: middleware → routes → run migrations → listen
│   ├── config/database.js     # Sequelize instance
│   ├── models/index.js        # all models + associations
│   ├── middleware/            # auth.js (JWT), scope.js (owner isolation)
│   ├── migrations/            # 001_initial_schema.sql, 002_... — schema source of truth
│   ├── routes/                # auth, users, leads, activityLog, stageHistory,
│   │                          # settings, dropdowns, uploads, forecast (public)
│   ├── scripts/
│   │   ├── migrate.js         # applies pending migrations/*.sql, tracks in schema_migrations
│   │   └── seed.js            # admin + team (each own bcrypt password) + settings + dropdowns
│   └── uploads/               # PO documents (gitignored, back this up)
└── frontend/
    └── src/
        ├── App.jsx            # router + route guards + injected global CSS
        ├── globalStyles.js    # single CSS string (utility classes)
        ├── context/AuthContext.jsx
        ├── services/api.js    # one axios instance + every endpoint fn
        ├── components/        # Layout, Sidebar, LeadForm, KanbanView,
        │                      # ActivityLogView, MultiSelect, PrivateRoute
        ├── pages/             # Login, Leads, Dashboard, Forecast, Reports,
        │                      # Settings, ChangePassword
        └── utils/             # constants.js, leadHelpers.js (pure functions)
```

---

*BizzRepp — conceived and architected by Aditya Mishra · Product & Program Management.*
