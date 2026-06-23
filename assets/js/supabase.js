/* =========================================================================
   Bigpot Publication — Supabase client
   -------------------------------------------------------------------------
   1. Create a free project at https://supabase.com
   2. Project Settings → API → copy the "Project URL" and the "anon public" key
   3. Paste them below.

   The anon key is SAFE to expose in the browser — every table is protected
   by Row-Level Security (see supabase/schema.sql). NEVER put the service_role
   key here.

   Until you fill these in, the site automatically falls back to the local
   catalogue in data.js, so it keeps working offline / from a file.
   ========================================================================= */

window.SUPABASE_CONFIG = {
  url:     "https://lxyorgsjyprzwmwsjdwu.supabase.co",        // e.g. https://abcdxyz.supabase.co
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4eW9yZ3NqeXByendtd3NqZHd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDM3NzUsImV4cCI6MjA5Nzc3OTc3NX0.Pr6Q4ABNK05Ex-pJYQw-9rBla9teW1m-nnxdJO3OHPo"

(function () {
  const cfg = window.SUPABASE_CONFIG;
  const configured =
    cfg.url &&
    cfg.anonKey &&
    !/YOUR_SUPABASE/.test(cfg.url) &&
    !/YOUR_SUPABASE/.test(cfg.anonKey) &&
    typeof window.supabase !== "undefined";

  window.SUPABASE_ENABLED = !!configured;
  window.sb = configured
    ? window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true }
      })
    : null;

  if (!configured) {
    console.info(
      "[Bigpot] Supabase not configured — using the local catalogue fallback. " +
      "Add your project URL + anon key in assets/js/supabase.js to go live."
    );
  }
})();
