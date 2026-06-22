// ============================================================
//  supabaseSidebarBadges.js  —  Real-time sidebar badge updates
// ============================================================

import { supabase } from '../supabase-config.js'

let badgesListener = null

export async function mountSidebarBadges(options = {}) {
  const currentRole = options.currentRole || 'user'
  
  try {
    // Subscribe to real-time updates on summary table
    if (badgesListener) badgesListener.unsubscribe()
    
    badgesListener = supabase
      .channel('summary-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'summary'
        },
        (payload) => {
          updateBadgesDisplay(payload.new)
        }
      )
      .subscribe()
    
    // Initial fetch
    const { data, error } = await supabase
      .from('summary')
      .select('*')
      .limit(1)
      .single()
    
    if (error && error.code !== 'PGRST116') {
      console.error('Summary fetch error:', error)
    } else if (data) {
      updateBadgesDisplay(data)
    }
  } catch (error) {
    console.warn('[badges]', error?.message || error)
  }
}

function updateBadgesDisplay(summary) {
  if (!summary) return
  
  const badges = [
    { id: 'nav-treatments-badge', value: summary.scheduledThisMonth || 0 },
    { id: 'nav-overdue-badge', value: summary.overdueT || 0 },
    { id: 'nav-complaints-badge', value: summary.openComplaints || 0 },
    { id: 'nav-inspections-badge', value: summary.openInspections || 0 },
    { id: 'nav-payments-badge', value: summary.pendingPayments || 0 }
  ]
  
  badges.forEach(({ id, value }) => {
    const el = document.getElementById(id)
    if (el && value > 0) {
      el.textContent = value
      el.style.display = 'inline-block'
    } else if (el) {
      el.style.display = 'none'
    }
  })
}

export function unsubscribeBadges() {
  if (badgesListener) {
    badgesListener.unsubscribe()
    badgesListener = null
  }
}
