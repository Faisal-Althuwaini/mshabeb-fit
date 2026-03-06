const { createClient } = require('@supabase/supabase-js');
const { getConfig } = require('./config.js');

let client = null;

function getSupabase() {
  if (!client) {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getConfig();
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

module.exports = { getSupabase };
