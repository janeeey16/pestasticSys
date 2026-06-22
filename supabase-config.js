// ============================================================
//  supabase-config.js  —  Single source of truth for Supabase
//
//  HOW TO UPDATE FOR A NEW SUPABASE PROJECT:
//  1. Go to Supabase Dashboard → Project Settings → API
//  2. Copy the Project URL and Anon Key
//  3. Paste them below
//  4. Save this file — all pages update automatically
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'

export const supabaseUrl = 'https://bnhymmdcerrqcrkoekyz.supabase.co'
export const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJuaHltbWRjZXJycWNya29la3l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMTE2NDEsImV4cCI6MjA5NzY4NzY0MX0.fRR8hT9tnWAVjbgvOxVccwca2v_J4N-CfMHreJjAdiE'

export const supabase = createClient(supabaseUrl, supabaseKey)
