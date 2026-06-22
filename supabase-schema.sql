-- ============================================================
--  Supabase schema for Pestastic  (native, matches js/db.js)
--
--  HOW TO APPLY
--  1. Open Supabase Dashboard -> SQL Editor
--  2. Paste this whole file and Run.
--
--  This REPLACES the earlier idealised relational schema, whose
--  column names did not match the fields the app actually uses.
--
--  Data model
--  ----------
--  FLAT tables (real columns) ...... users, summary, audit_log
--  JSONB document tables (id+data) . clients, contracts, treatments,
--                                    payments, complaints, inspections,
--                                    renewals, teams, config
--
--  JSONB tables mirror the original Firestore documents exactly, so
--  every camelCase field the app reads/writes works without having to
--  predeclare a column. camelCase identifiers on the flat tables are
--  quoted so PostgreSQL preserves their case.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop the old mismatched business/config tables (safe: re-created below).
DROP TABLE IF EXISTS clients      CASCADE;
DROP TABLE IF EXISTS contracts    CASCADE;
DROP TABLE IF EXISTS treatments   CASCADE;
DROP TABLE IF EXISTS payments     CASCADE;
DROP TABLE IF EXISTS complaints   CASCADE;
DROP TABLE IF EXISTS inspections  CASCADE;
DROP TABLE IF EXISTS renewals     CASCADE;
DROP TABLE IF EXISTS teams        CASCADE;
DROP TABLE IF EXISTS config       CASCADE;
DROP TABLE IF EXISTS counters     CASCADE;

-- ============================================================
--  FLAT TABLES
-- ============================================================

-- 1. USERS (keyed by Supabase auth user id, stored in "uid")
CREATE TABLE IF NOT EXISTS users (
  uid           TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  "displayName" TEXT,
  "photoURL"    TEXT,
  role          TEXT DEFAULT 'user'    CHECK (role   IN ('user','admin','super_admin')),
  status        TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  "lastLogin"   TIMESTAMPTZ,
  "createdAt"   TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role   ON users(role);

GRANT SELECT, INSERT, UPDATE, DELETE ON users TO authenticated;
GRANT ALL ON users TO service_role;

-- 2. SUMMARY (single 'dashboard' row driving the sidebar badges)
CREATE TABLE IF NOT EXISTS summary (
  id                    TEXT PRIMARY KEY DEFAULT 'dashboard',
  "totalClients"        INTEGER DEFAULT 0,
  "activeContracts"     INTEGER DEFAULT 0,
  "scheduledThisMonth"  INTEGER DEFAULT 0,
  "overdueT"            INTEGER DEFAULT 0,
  "openComplaints"      INTEGER DEFAULT 0,
  "openInspections"     INTEGER DEFAULT 0,
  "pendingPayments"     INTEGER DEFAULT 0,
  "treatmentsToday"     INTEGER DEFAULT 0,
  "renewalsDueThisMonth" INTEGER DEFAULT 0,
  "updatedAt"           TIMESTAMPTZ DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON summary TO authenticated;
GRANT ALL ON summary TO service_role;

-- 3. AUDIT LOG (append-only activity feed)
CREATE TABLE IF NOT EXISTS audit_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action           TEXT,
  "entityType"     TEXT,
  "entityId"       TEXT,
  description      TEXT,
  "performedBy"    TEXT,
  "performedByUid" TEXT,
  details          JSONB,
  "createdAt"      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log("createdAt" DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log TO authenticated;
GRANT ALL ON audit_log TO service_role;

-- ============================================================
--  JSONB DOCUMENT TABLES
--  Each row: { id, data (all app fields), createdAt, updatedAt }
-- ============================================================

CREATE TABLE clients     (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, data JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE contracts   (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, data JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE treatments  (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, data JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE payments    (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, data JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE complaints  (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, data JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE inspections (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, data JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE renewals    (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, data JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW());
CREATE TABLE teams       (id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text, data JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW());
-- config holds the 'settings' and 'counters' documents
CREATE TABLE config      (id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}', "createdAt" TIMESTAMPTZ DEFAULT NOW(), "updatedAt" TIMESTAMPTZ DEFAULT NOW());

-- Helpful indexes for the common lookups the app performs.
CREATE INDEX idx_contracts_customerNo  ON contracts  ((data->>'customerNo'));
CREATE INDEX idx_treatments_contractId ON treatments ((data->>'contractId'));
CREATE INDEX idx_payments_contractId   ON payments   ((data->>'contractId'));
CREATE INDEX idx_complaints_customerNo ON complaints ((data->>'customerNo'));

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','contracts','treatments','payments','complaints','inspections','renewals','teams','config']
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO authenticated', t);
    EXECUTE format('GRANT ALL ON %I TO service_role', t);
  END LOOP;
END $$;

-- ============================================================
--  AUTH HELPER FUNCTIONS (security definer, bypass RLS safely)
-- ============================================================
CREATE OR REPLACE FUNCTION is_approved_user(user_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE uid = user_id AND status = 'approved')
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_admin_user(user_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE uid = user_id AND status = 'approved' AND role IN ('admin','super_admin'))
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION is_super_admin_user(user_id TEXT)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE uid = user_id AND role = 'super_admin')
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

-- ============================================================
--  ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE complaints  ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE renewals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams       ENABLE ROW LEVEL SECURITY;
ALTER TABLE config      ENABLE ROW LEVEL SECURITY;

-- USERS: a user sees/edits own row; admins see/edit all.
DROP POLICY IF EXISTS users_select ON users;
CREATE POLICY users_select ON users FOR SELECT TO authenticated
  USING (auth.uid()::text = uid OR is_admin_user(auth.uid()::text));
DROP POLICY IF EXISTS users_insert ON users;
CREATE POLICY users_insert ON users FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = uid);
DROP POLICY IF EXISTS users_update ON users;
CREATE POLICY users_update ON users FOR UPDATE TO authenticated
  USING (auth.uid()::text = uid OR is_admin_user(auth.uid()::text))
  WITH CHECK (auth.uid()::text = uid OR is_admin_user(auth.uid()::text));
DROP POLICY IF EXISTS users_delete ON users;
CREATE POLICY users_delete ON users FOR DELETE TO authenticated
  USING (is_super_admin_user(auth.uid()::text));

-- SUMMARY: approved users read; admins write.
DROP POLICY IF EXISTS summary_select ON summary;
CREATE POLICY summary_select ON summary FOR SELECT TO authenticated
  USING (is_approved_user(auth.uid()::text));
DROP POLICY IF EXISTS summary_write ON summary;
CREATE POLICY summary_write ON summary FOR ALL TO authenticated
  USING (is_admin_user(auth.uid()::text))
  WITH CHECK (is_admin_user(auth.uid()::text));

-- AUDIT LOG: approved users read & append.
DROP POLICY IF EXISTS audit_select ON audit_log;
CREATE POLICY audit_select ON audit_log FOR SELECT TO authenticated
  USING (is_approved_user(auth.uid()::text));
DROP POLICY IF EXISTS audit_insert ON audit_log;
CREATE POLICY audit_insert ON audit_log FOR INSERT TO authenticated
  WITH CHECK (is_approved_user(auth.uid()::text));

-- JSONB BUSINESS TABLES + CONFIG: approved users have full access.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','contracts','treatments','payments','complaints','inspections','renewals','teams','config']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_all ON %I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_all ON %I FOR ALL TO authenticated USING (is_approved_user(auth.uid()::text)) WITH CHECK (is_approved_user(auth.uid()::text))',
      t, t);
  END LOOP;
END $$;

-- ============================================================
--  REALTIME (sidebar badges subscribe to summary)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'summary'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE summary;
  END IF;
END $$;

-- ============================================================
--  SEED the singleton documents the app expects to exist.
-- ============================================================
INSERT INTO summary (id) VALUES ('dashboard') ON CONFLICT (id) DO NOTHING;
INSERT INTO config (id, data) VALUES
  ('settings', '{"salesAgents":[],"commSources":[]}'::jsonb),
  ('counters', '{"clientCounter":0,"contractCounter":0,"treatmentCounter":0}'::jsonb)
ON CONFLICT (id) DO NOTHING;
