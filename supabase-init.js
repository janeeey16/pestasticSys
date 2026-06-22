// ============================================================
//  sidebarBadges.js  —  Real-time sidebar badge counts (Supabase)
//  Mounts a realtime subscription on the `summary` table and keeps
//  the nav badges in sync. Re-exported from the Supabase
//  implementation so the import path stays the same on every page.
// ============================================================

export {
  mountSidebarBadges,
  unsubscribeBadges,
} from './supabaseSidebarBadges.js';
