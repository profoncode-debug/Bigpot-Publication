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
  url:     "https://oiqnpgcvlmwfmbnwkuxc.supabase.co",        // e.g. https://abcdxyz.supabase.co
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pcW5wZ2N2bG13Zm1ibndrdXhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxNDk1NTEsImV4cCI6MjA5NzcyNTU1MX0.lAYKeC28hn02rmsPdKolTO0U6CCNS6ZQ5-1omE2_Y4Y"    // the long "anon public" JWT
};

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
