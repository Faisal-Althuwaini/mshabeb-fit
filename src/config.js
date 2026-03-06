require('dotenv').config();

function getConfig() {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!BOT_TOKEN) {
    throw new Error('Missing BOT_TOKEN in environment. Get it from @BotFather on Telegram.');
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in .env (see .env.example).');
  }

  return {
    BOT_TOKEN,
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
  };
}

module.exports = { getConfig };
