// ============================================================
//  db.js  —  Native Supabase data layer
//
//  This module is the single backend for every page. It exports
//  the same names the pages used to import from Firebase
//  (collection, doc, query, where, orderBy, getDoc, addDoc,
//  serverTimestamp, runTransaction, writeBatch, the auth helpers,
//  and the cached/smart CRUD helpers) — but every function runs
//  entirely on Supabase. There is no Firebase code anywhere.
//
//  Data model
//  ----------
//  • FLAT tables  (real columns)  : users, summary, audit_log
//      These match the already-migrated login/layout pages and the
//      RLS policies that read users.uid / users.status / users.role.
//  • JSONB tables (id + data jsonb): clients, contracts, treatments,
//      payments, complaints, inspections, renewals, teams, config
//      These keep the schemaless camelCase fields the app uses, so
//      no field ever needs to match a fixed column.
//
//  See supabase-schema.sql for the matching database definition.
// ============================================================

import { supabase } from '../supabase-config.js';

/* ── Table classification ───────────────────────────────────── */
const FLAT_TABLES = new Set(['users', 'summary', 'audit_log']);
// Primary-key column name per flat table (JSONB tables always use "id").
const ID_COLUMN = { users: 'uid', summary: 'id', audit_log: 'id' };

function isFlat(table) {
  return FLAT_TABLES.has(table);
}
function idColumn(table) {
  return ID_COLUMN[table] || 'id';
}

/* ── Sentinels & value cleaning ─────────────────────────────── */
const SERVER_TS = Symbol('serverTimestamp');

export function serverTimestamp() {
  return SERVER_TS;
}

// Firestore-compatible Timestamp (stored as ISO strings in Supabase).
export class Timestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static now() {
    return Timestamp.fromMillis(Date.now());
  }
  static fromDate(d) {
    return Timestamp.fromMillis(d.getTime());
  }
  static fromMillis(ms) {
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  toDate() {
    return new Date(this.seconds * 1000 + this.nanoseconds / 1e6);
  }
  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toJSON() {
    return this.toDate().toISOString();
  }
}

// Firestore-compatible arrayUnion sentinel (merged in smartUpdateDoc).
export function arrayUnion(...items) {
  return { __arrayUnion: items };
}



export function increment(n) {
  return { __increment: n };
}

// Recursively replace serverTimestamp sentinels and Date objects with
// ISO strings so the value is safe for JSON / timestamptz columns.
function cleanValue(val) {
  if (val === SERVER_TS) return new Date().toISOString();
  if (val instanceof Date) return val.toISOString();
  if (Array.isArray(val)) return val.map(cleanValue);
  if (val && typeof val === 'object') {
    if (val.toDate && typeof val.toDate === 'function') {
      return val.toDate().toISOString();
    }
    const out = {};
    for (const k of Object.keys(val)) out[k] = cleanValue(val[k]);
    return out;
  }
  return val;
}

function cleanData(data) {
  const out = {};
  for (const k of Object.keys(data || {})) out[k] = cleanValue(data[k]);
  return out;
}

/* ── Reference builders (descriptors, not Firebase objects) ──── */
export const db = { __isDb: true };
export const auth = { __isAuth: true };
export const app = { __isApp: true };
export const firebaseConfig = {};

export function getFirestore() {
  return db;
}
export function initializeApp() {
  return app;
}
export function getAuth() {
  return auth;
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

export function collection(_db, table) {
  return { __type: 'collection', table, constraints: [] };
}

export function doc(a, b, c) {
  // doc(collectionRef)            -> new auto id
  // doc(collectionRef, id)        -> explicit id
  // doc(db, table, id)            -> explicit id
  // doc(db, table)                -> new auto id
  if (a && a.__type === 'collection') {
    return { __type: 'doc', table: a.table, id: b != null ? b : newId() };
  }
  return { __type: 'doc', table: b, id: c != null ? c : newId() };
}

export function query(ref, ...constraints) {
  return {
    __type: 'query',
    table: ref.table,
    constraints: [...(ref.constraints || []), ...constraints],
  };
}

export function where(field, op, value) {
  return { __c: 'where', field, op, value };
}
export function orderBy(field, dir = 'asc') {
  return { __c: 'orderBy', field, dir };
}
export function limit(n) {
  return { __c: 'limit', n };
}
export function startAfter() {
  return { __c: 'startAfter' };
}

/* ── Operator mapping (Firestore -> PostgREST) ──────────────── */
const OP_MAP = {
  '==': 'eq',
  '!=': 'neq',
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  in: 'in',
  'array-contains': 'cs',
};

function applyConstraints(builder, table, constraints) {
  for (const c of constraints) {
    if (!c) continue;
    if (c.__c === 'where') {
      const col = isFlat(table) ? c.field : `data->>${c.field}`;
      const op = OP_MAP[c.op] || 'eq';
      builder = builder.filter(col, op, c.value);
    } else if (c.__c === 'orderBy') {
      const col = isFlat(table) ? c.field : `data->>${c.field}`;
      builder = builder.order(col, { ascending: c.dir !== 'desc' });
    } else if (c.__c === 'limit') {
      builder = builder.limit(c.n);
    }
  }
  return builder;
}

/* ── Snapshot shapes (mirror the Firestore API surface) ─────── */
function makeDocFromRow(table, row) {
  const id = isFlat(table) ? row[idColumn(table)] : row.id;
  const fields = isFlat(table) ? row : row.data || {};
  return {
    id,
    exists: () => true,
    data: () => fields,
    get: (f) => fields[f],
    ref: { __type: 'doc', table, id },
  };
}

function makeQuerySnapshot(table, rows) {
  const docs = rows.map((r) => makeDocFromRow(table, r));
  return {
    docs,
    size: docs.length,
    empty: docs.length === 0,
    forEach(cb) {
      docs.forEach(cb);
    },
  };
}

/* ── Reads ──────────────────────────────────────────────────── */
export async function cachedGetDocs(queryOrColl) {
  const table = queryOrColl.table;
  const select = isFlat(table) ? '*' : 'id, data';
  let builder = supabase.from(table).select(select);
  builder = applyConstraints(builder, table, queryOrColl.constraints || []);
  const { data, error } = await builder;
  if (error) throw error;
  return makeQuerySnapshot(table, data || []);
}

// Alias kept for any direct getDocs callers.
export const getDocs = cachedGetDocs;

export async function getDoc(docRef) {
  const { table, id } = docRef;
  const select = isFlat(table) ? '*' : 'id, data';
  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq(idColumn(table), id)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) {
    return { id, exists: () => false, data: () => undefined };
  }
  const fields = isFlat(table) ? data : data.data || {};
  return {
    id,
    exists: () => true,
    data: () => fields,
    get: (f) => fields[f],
  };
}

// cachedGetDoc accepts either a docRef or (table, id).
export async function cachedGetDoc(refOrTable, maybeId) {
  if (typeof refOrTable === 'string') {
    return getDoc(doc(db, refOrTable, maybeId));
  }
  return getDoc(refOrTable);
}

/* ── Writes ─────────────────────────────────────────────────── */
export async function smartAddDoc(collRef, data) {
  const table = collRef.table;
  const clean = cleanData(data);
  let row;
  if (isFlat(table)) {
    row = clean;
  } else {
    row = { id: newId(), data: clean, updatedAt: new Date().toISOString() };
  }
  const { data: inserted, error } = await supabase
    .from(table)
    .insert([row])
    .select()
    .single();
  if (error) throw error;
  const id = isFlat(table) ? inserted[idColumn(table)] : inserted.id;
  return { id, ...(isFlat(table) ? inserted : clean) };
}

export async function smartUpdateDoc(docRef, data) {
  const { table, id } = docRef;
  const clean = cleanData(data);
  if (isFlat(table)) {
    const { error } = await supabase
      .from(table)
      .update(clean)
      .eq(idColumn(table), id);
    if (error) throw error;
  } else {
    // Merge into existing jsonb document (shallow, like Firestore update()).
    const { data: existing, error: selErr } = await supabase
      .from(table)
      .select('data')
      .eq('id', id)
      .maybeSingle();
    if (selErr && selErr.code !== 'PGRST116') throw selErr;
    const base = (existing && existing.data) || {};
    const merged = { ...base, ...clean };
    // Resolve arrayUnion() sentinels against the existing array values.
    for (const k of Object.keys(clean)) {
      const v = clean[k];
      if (v && typeof v === 'object' && Array.isArray(v.__arrayUnion)) {
        const current = Array.isArray(base[k]) ? base[k] : [];
        const additions = v.__arrayUnion.filter((x) => !current.includes(x));
        merged[k] = [...current, ...additions];
      }
    }
    const { error } = await supabase
      .from(table)
      .update({ data: merged, updatedAt: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  }
  return { id, ...clean };
}

export async function smartSetDoc(docRef, data, options = {}) {
  const { table, id } = docRef;
  const clean = cleanData(data);
  const merge = !!options.merge;
  if (isFlat(table)) {
    const row = { [idColumn(table)]: id, ...clean };
    const { error } = await supabase
      .from(table)
      .upsert(row, { onConflict: idColumn(table) });
    if (error) throw error;
  } else {
    let payload = clean;
    if (merge) {
      const { data: existing } = await supabase
        .from(table)
        .select('data')
        .eq('id', id)
        .maybeSingle();
      payload = { ...((existing && existing.data) || {}), ...clean };
    }
    const { error } = await supabase
      .from(table)
      .upsert(
        { id, data: payload, updatedAt: new Date().toISOString() },
        { onConflict: 'id' },
      );
    if (error) throw error;
  }
  return { id, ...clean };
}

export async function smartDeleteDoc(docRef) {
  const { table, id } = docRef;
  const { error } = await supabase.from(table).delete().eq(idColumn(table), id);
  if (error) throw error;
}

/* Aliases so any direct Firestore-style write callers still work. */
export const addDoc = smartAddDoc;
export const updateDoc = smartUpdateDoc;
export const setDoc = (ref, data, opts) => smartSetDoc(ref, data, opts);
export const deleteDoc = smartDeleteDoc;

/* No caching layer anymore — invalidation is a no-op. */
export async function invalidateAfterWrite() {}
export async function invalidateCache() {}

export async function updateLastLoginNoInvalidate(refOrUid) {
  const uid = typeof refOrUid === 'string' ? refOrUid : refOrUid && refOrUid.id;
  if (!uid) return;
  try {
    await supabase
      .from('users')
      .update({ lastLogin: new Date().toISOString() })
      .eq('uid', uid);
  } catch (err) {
    console.warn('lastLogin update failed:', err?.message || err);
  }
}

/* ── Transactions (best-effort emulation) ───────────────────── */
export async function runTransaction(_db, fn) {
  const writes = [];
  const tx = {
    get: (ref) => getDoc(ref),
    set: (ref, data) => writes.push(['set', ref, data]),
    update: (ref, data) => writes.push(['update', ref, data]),
    delete: (ref) => writes.push(['delete', ref]),
  };
  const result = await fn(tx);
  for (const [op, ref, data] of writes) {
    if (op === 'set') await smartSetDoc(ref, data, { merge: true });
    else if (op === 'update') await smartUpdateDoc(ref, data);
    else if (op === 'delete') await smartDeleteDoc(ref);
  }
  return result;
}

/* ── Batched writes ─────────────────────────────────────────── */
export function writeBatch() {
  const ops = [];
  return {
    set: (ref, data, opts) => ops.push(['set', ref, data, opts]),
    update: (ref, data) => ops.push(['update', ref, data]),
    delete: (ref) => ops.push(['delete', ref]),
    async commit() {
      for (const [op, ref, data, opts] of ops) {
        if (op === 'set') await smartSetDoc(ref, data, opts || {});
        else if (op === 'update') await smartUpdateDoc(ref, data);
        else if (op === 'delete') await smartDeleteDoc(ref);
      }
    },
  };
}

/* ── Auth (Supabase, Google OAuth) ──────────────────────────── */
export class GoogleAuthProvider {
  constructor() {
    this.scopes = [];
  }
  addScope(s) {
    this.scopes.push(s);
  }
  setCustomParameters() {}
}

function normalizeUser(u) {
  if (!u) return null;
  const meta = u.user_metadata || {};
  return {
    uid: u.id,
    email: u.email || '',
    displayName: meta.full_name || meta.name || '',
    photoURL: meta.avatar_url || meta.picture || '',
    emailVerified: !!u.email_confirmed_at,
    providerData: [],
    _raw: u,
  };
}

export function onAuthStateChanged(_auth, callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
    callback(normalizeUser(session && session.user));
  });
  return () => {
    try {
      data.subscription.unsubscribe();
    } catch {
      /* noop */
    }
  };
}

export function signOut() {
  return supabase.auth.signOut();
}

export async function signInWithPopup() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
  return { user: null };
}

export { supabase };
