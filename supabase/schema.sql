-- Run this in Supabase SQL Editor to create tables for the weight tracker bot.
-- Use the service role key in the bot (server-side only); RLS can be disabled for these tables
-- or configured to allow service role full access.

-- Users: one row per Telegram user
CREATE TABLE IF NOT EXISTS users (
  telegram_user_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  reminder_enabled BOOLEAN DEFAULT FALSE,
  reminder_time TIME,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Weight entries: one per user per day (upsert by user_id + date)
CREATE TABLE IF NOT EXISTS weight_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  weight NUMERIC(5, 2) NOT NULL CHECK (weight >= 20 AND weight <= 300),
  recorded_at DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_weight_entries_user_recorded
  ON weight_entries (user_id, recorded_at DESC);

-- Optional: trigger to update users.updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
