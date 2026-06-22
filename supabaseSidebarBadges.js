// ============================================================
//  supabase-init.js  —  Centralized Supabase initialization
// ============================================================

import { supabase } from '../supabase-config.js'

// Export for use in all pages
export { supabase }

// ── Auth State Listener ──
let currentUser = null
let currentUserData = null

supabase.auth.onAuthStateChange(async (event, session) => {
  if (session?.user) {
    currentUser = session.user
    // Fetch user metadata from users table
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('uid', session.user.id)
        .single()
      
      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching user data:', error)
      }
      currentUserData = data
    } catch (err) {
      console.error('User fetch error:', err)
    }
  } else {
    currentUser = null
    currentUserData = null
  }
})

export { currentUser, currentUserData }
