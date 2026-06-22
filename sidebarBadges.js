// ============================================================
//  pageInit.js  —  Shared page bootstrap (Supabase)
//
//  Provides the small UI helpers every page uses:
//    • mountLastUpdated()  — "Updated · 2m ago" topbar badge
//    • wireRefreshButton() — wires #btn-refresh to a refresh fn
//    • wireSignOut()       — wires .btn-signout / [data-action=signout]
//    • bootstrapPage()     — optional one-call auth + badges bootstrap
//  All Firebase usage has been removed; everything runs on Supabase.
// ============================================================

import {
  onAuthStateChanged,
  signOut,
  auth,
  db,
  doc,
  getDoc,
  smartSetDoc,
  serverTimestamp,
  updateLastLoginNoInvalidate,
} from './db.js';
import { mountSidebarBadges } from './sidebarBadges.js';

/* ── "Updated · 2m ago" relative time formatting ── */
export function formatAge(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

/**
 * One-call page bootstrap: gate by auth + approval, mount badges.
 * Pages may use this OR run their own onAuthStateChanged — both work.
 */
export function bootstrapPage({
  onReady,
  onPending = () => location.replace('login.html'),
  onSignedOut = () => location.replace('login.html'),
} = {}) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      onSignedOut();
      return;
    }
    try {
      const userRef = doc(db, 'users', user.uid);
      const snap = await getDoc(userRef);

      if (!snap.exists()) {
        await smartSetDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || '',
          photoURL: user.photoURL || '',
          role: 'user',
          status: 'pending',
          createdAt: serverTimestamp(),
          lastLogin: serverTimestamp(),
        });
        onPending();
        return;
      }

      const data = snap.data();
      updateLastLoginNoInvalidate(userRef).catch(() => {});

      if (data.status !== 'approved') {
        onPending();
        return;
      }

      mountSidebarBadges({ currentRole: data.role });
      onReady?.({ user, role: data.role });
    } catch (err) {
      console.error('[bootstrapPage]', err);
      onSignedOut();
    }
  });
}

/** Inject a "Last updated · 2m ago" element into the topbar. */
export function mountLastUpdated() {
  let el = document.getElementById('last-updated');
  if (!el) {
    el = document.createElement('span');
    el.id = 'last-updated';
    el.className = 'last-updated-badge';
    el.style.cssText =
      'font-size:12px;color:#9ca3af;margin-right:8px;white-space:nowrap;';
    const topbar =
      document.querySelector('.topbar') || document.querySelector('header');
    if (topbar) {
      const btnSlot = topbar.querySelector('.topbar-btn, button');
      if (btnSlot) topbar.insertBefore(el, btnSlot);
      else topbar.appendChild(el);
    }
  }
  let lastTs = 0;
  let fromCache = false;
  function render() {
    if (!lastTs) return;
    const prefix = fromCache ? 'Cached · ' : 'Updated · ';
    el.textContent = prefix + formatAge(lastTs);
  }
  function setUpdated(ts, isCache = false) {
    lastTs = ts || Date.now();
    fromCache = !!isCache;
    render();
  }
  setInterval(render, 5000);
  return { setUpdated, render, el };
}

/** Wire a manual refresh button (#btn-refresh) to a refresh function. */
export function wireRefreshButton(refreshFn) {
  const btn = document.getElementById('btn-refresh');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '↻';
    btn.style.animation = 'pc-spin 0.8s linear infinite';
    try {
      await refreshFn();
    } finally {
      btn.disabled = false;
      btn.textContent = original;
      btn.style.animation = '';
    }
  });
  if (!document.getElementById('pc-spin-style')) {
    const style = document.createElement('style');
    style.id = 'pc-spin-style';
    style.textContent =
      '@keyframes pc-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }
}

/** Common sign-out wiring for sidebar/topbar buttons. */
export function wireSignOut() {
  document
    .querySelectorAll('.btn-signout, [data-action="signout"]')
    .forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        signOut().then(() => location.replace('login.html'));
      });
    });
}
