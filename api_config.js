// api_config.js — single place to point the dashboard at the MOU69_DB read bridge (Apps Script).
//
// Phase 1 (current): READ-ONLY. Only `health` and `bootstrap` are implemented server-side —
// see apps_script/Code.gs. Nothing here ever writes to MOU69_DB.
//
// Leave API_BASE_URL empty ('') until the Apps Script is deployed as a Web App and you have a
// real .../exec URL. With it empty, api_client.js does nothing at all — the dashboard behaves
// exactly as it did before this file existed (100% localStorage, no network calls, no UI change).
//
// Once deployed, paste the URL here (and only here — no other file should ever hardcode it):
const API_BASE_URL = 'https://script.google.com/macros/s/AKfycbwuD5km4IW-jx8HiwW77axt61aM5AV7JfZkbiq-P9SrK608-8lplQoLkSbaDGvvATYnog/exec';

// Fiscal year (Buddhist Era) used for the bootstrap read — matches ENTRY_ANNUAL_FRAMEWORK_SEED's
// convention in entry_config.js ('2569'), kept as its own constant so this file has zero
// dependency on load order relative to entry_config.js.
const API_FISCAL_YEAR = '2569';
