/* admin-config.example.js — COPY to admin-config.local.js and fill in.
   admin-config.local.js is gitignored and is never deployed.
   Nothing in the ERP depends on these; they are for the admin panel only. */
window.ADMIN_CONFIG = {
  /* Supabase service_role key. Rotate it in the dashboard, then paste the
     new one here. Never commit this file. */
  serviceKey: '',
  /* Admin panel password. */
  adminPass: ''
};
