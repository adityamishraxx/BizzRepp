import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { PrivateRoute, AdminRoute, ModuleRoute, SuperAdminRoute } from './components/PrivateRoute';
import LoginPage from './pages/LoginPage';
import BusinessUnitsPage from './pages/BusinessUnitsPage';
import LeadsPage from './pages/LeadsPage';
import DashboardPage from './pages/DashboardPage';
import ForecastPage from './pages/ForecastPage';
import ActivityPage from './pages/ActivityPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import VocPage from './pages/VocPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import SsoSelectPage from './pages/SsoSelectPage';
import { GLOBAL_CSS } from './globalStyles';
import { BASE_PATH, IS_PROD } from './env';

// === JIOAUTIFY INTEGRATION: capture the SSO hand-off SYNCHRONOUSLY at module load, BEFORE React
// Router renders. The STB ("Jioautify") portal opens Sales CRM in one of two ways:
//   • /sales_crm?token=<jwt>&data=<user>  — single account: seed the token and land on /leads.
//   • /sales_crm?ssoTicket=<jwt>          — the email has two accounts (signage + jhes): stash the
//                                           chooser ticket and land on /sso-select, which renders
//                                           the account picker and redeems a token for the chosen BU.
// Doing this synchronously (not in a useEffect) means AuthProvider initialises already-logged-in on
// the first render, so the guard never bounces to /login and strips the query. Tokens/tickets are
// namespaced (salescrm_*) to avoid clobbering the portal's own 'Token'. Mirrors Jio Inventory. ===
(function captureSsoFromUrl() {
  if (!BASE_PATH || typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    const rawData = params.get('data'); // URLSearchParams already URI-decodes -> raw JSON string
    const ssoTicket = params.get('ssoTicket');
    if (token && rawData) {
      JSON.parse(rawData); // validate it is well-formed before storing
      localStorage.setItem('salescrm_token', token);
      window.history.replaceState({}, document.title, BASE_PATH + '/leads');
    } else if (ssoTicket) {
      sessionStorage.setItem('salescrm_sso_ticket', ssoTicket);
      window.history.replaceState({}, document.title, BASE_PATH + '/sso-select');
    }
  } catch (e) {
    console.error('[SSO] failed to capture token/data from URL:', e);
  }
})();

export default function App() {
  return (
    <>
      <style>{GLOBAL_CSS}</style>
      <AuthProvider>
        {/* === JIOAUTIFY INTEGRATION: served under /sales_crm by the STB backend in production; root
            in standalone dev. basename derives from NODE_ENV via env.js (build-time constant). === */}
        <BrowserRouter basename={BASE_PATH || '/'}>
          <Routes>
            {/* Public */}
            <Route path="/" element={<LoginPage />} />
            <Route path="/login" element={<LoginPage />} />
            {/* N3: Forecast is a regular in-platform module — no standalone login. */}
            <Route path="/forecast" element={<PrivateRoute><ModuleRoute module="forecast"><ForecastPage /></ModuleRoute></PrivateRoute>} />
            {/* === JIOAUTIFY INTEGRATION: SSO account chooser (prod handoff for emails with two BU
                accounts). Redeems the ticket stashed by captureSsoFromUrl, then bypasses login. === */}
            <Route path="/sso-select" element={<SsoSelectPage />} />

            {/* Authenticated — any role */}
            <Route path="/leads"            element={<PrivateRoute><ModuleRoute module="leads"><LeadsPage /></ModuleRoute></PrivateRoute>} />
            <Route path="/dashboard"        element={<PrivateRoute><ModuleRoute module="dashboard"><DashboardPage /></ModuleRoute></PrivateRoute>} />
            {/* Global activity feed (J1). Not a per-module page — its own grant governs it
                (Business Admin / Global Admin by role, Manager if granted, Team Member never), so the
                page itself enforces that rather than the module guard. */}
            <Route path="/activity"         element={<PrivateRoute><ActivityPage /></PrivateRoute>} />
            {/* VOC (Voice of Customer) — Surveillance only (gated inside the page + API). */}
            <Route path="/voc"              element={<PrivateRoute><VocPage /></PrivateRoute>} />
            {/* Self-service password change is DEV-ONLY; production is SSO-only. */}
            {!IS_PROD && (
              <Route path="/change-password"  element={<PrivateRoute><ChangePasswordPage /></PrivateRoute>} />
            )}

            {/* Admin/PMO only */}
            <Route path="/reports"          element={<AdminRoute><ModuleRoute module="reports"><ReportsPage /></ModuleRoute></AdminRoute>} />
            <Route path="/settings"         element={<AdminRoute><SettingsPage /></AdminRoute>} />
            {/* Global Admin only — dynamic Business Unit management. */}
            <Route path="/business-units"   element={<SuperAdminRoute><BusinessUnitsPage /></SuperAdminRoute>} />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/leads" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </>
  );
}
