// Corkly cloud layer — Firebase auth + shared boards.
// Bundled by esbuild into src/renderer/cloud.js (window.CorklyCloud). Run `npm run build:cloud` after editing.
import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, connectAuthEmulator,
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as fbSignOut,
  sendPasswordResetEmail, updateProfile,
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, memoryLocalCache, connectFirestoreEmulator,
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, where,
  serverTimestamp, Timestamp, writeBatch, Bytes,
} from 'firebase/firestore';

let app, auth, db;
let ready = false;
let currentUser = null;

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
export const prettyCode = (c) => `${c.slice(0, 5)}-${c.slice(5)}`;
const cleanCode = (c) => String(c || '').toUpperCase().replace(/^CORKLY:\/\/JOIN\//, '').replace(/[^A-Z0-9]/g, '');

const userInfo = (u) => (u ? { uid: u.uid, email: u.email, name: u.displayName || (u.email || '').split('@')[0] } : null);

export function init(config) {
  if (ready) return true;
  if (!config || !config.apiKey) return false;
  app = initializeApp(config);
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  let cache;
  try { cache = persistentLocalCache({ tabManager: persistentMultipleTabManager() }); } catch { cache = memoryLocalCache(); }
  db = initializeFirestore(app, { localCache: config.emulator ? memoryLocalCache() : cache, ignoreUndefinedProperties: true });
  if (config.emulator) {
    const h = config.emulator.host || '127.0.0.1';
    connectAuthEmulator(auth, `http://${h}:${config.emulator.auth || 9099}`, { disableWarnings: true });
    connectFirestoreEmulator(db, h, config.emulator.firestore || 8080);
  }
  ready = true;
  return true;
}

export const isReady = () => ready;
export const me = () => userInfo(currentUser);

export function onAuth(cb) {
  return onAuthStateChanged(auth, (u) => { currentUser = u; cb(userInfo(u)); });
}

export async function signUp(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  if (name) await updateProfile(cred.user, { displayName: name.trim() });
  currentUser = auth.currentUser;
  return userInfo(currentUser);
}
export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  currentUser = cred.user;
  return userInfo(cred.user);
}
export const signOut = () => fbSignOut(auth);
export const resetPassword = (email) => sendPasswordResetEmail(auth, email.trim());

export function friendlyError(e) {
  const code = (e && e.code) || '';
  const map = {
    'auth/invalid-email': 'That email address doesn’t look right.',
    'auth/missing-password': 'Please enter a password.',
    'auth/weak-password': 'Use at least 6 characters for your password.',
    'auth/email-already-in-use': 'There’s already an account with that email — try signing in.',
    'auth/invalid-credential': 'Email or password is wrong.',
    'auth/wrong-password': 'Email or password is wrong.',
    'auth/user-not-found': 'No account with that email yet — create one.',
    'auth/too-many-requests': 'Too many tries. Wait a minute and try again.',
    'auth/network-request-failed': 'Can’t reach the internet right now.',
    'permission-denied': 'You don’t have access to that.',
    'not-found': 'That doesn’t exist anymore.',
    unavailable: 'Can’t reach the internet right now.',
  };
  return map[code] || (e && e.message) || 'Something went wrong.';
}

// ---------- paths ----------
const boardRef = (b) => doc(db, 'boards', b);
const itemsCol = (b) => collection(db, 'boards', b, 'items');
const stringsCol = (b) => collection(db, 'boards', b, 'strings');
const membersCol = (b) => collection(db, 'boards', b, 'members');
const userBoardRef = (uid, b) => doc(db, 'users', uid, 'boards', b);

function requireUser() {
  if (!currentUser) throw Object.assign(new Error('Please sign in first.'), { code: 'auth/required' });
  return userInfo(currentUser);
}

// ---------- images ----------
// Photos are stored as compressed bytes in Firestore (boards/{b}/images/{id}, < 1 MB each),
// so no Cloud Storage bucket (or paid plan) is needed.
const imagesCol = (b) => collection(db, 'boards', b, 'images');
export async function saveImage(boardId, imageId, bytes, mime, ratio) {
  const u = requireUser();
  await setDoc(doc(imagesCol(boardId), imageId), {
    data: Bytes.fromUint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
    mime: mime || 'image/jpeg', ratio: ratio || 1, authorId: u.uid, createdAt: Date.now(),
  });
  return imageId;
}
export async function loadImage(boardId, imageId) {
  const snap = await getDoc(doc(imagesCol(boardId), imageId));
  if (!snap.exists()) return null;
  const d = snap.data();
  return { bytes: d.data.toUint8Array(), mime: d.mime, ratio: d.ratio };
}
export const deleteImage = (boardId, imageId) => deleteDoc(doc(imagesCol(boardId), imageId));

// ---------- sharing ----------
// Creates the cloud copy of a board. `items`/`strings` must already be in cloud form.
export async function createSharedBoard({ name, bg, items, strings }) {
  const u = requireUser();
  const id = doc(collection(db, 'boards')).id;
  await setDoc(boardRef(id), { name, bg, ownerId: u.uid, ownerName: u.name, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await setDoc(doc(membersCol(id), u.uid), { role: 'owner', name: u.name, email: u.email || '', joinedAt: serverTimestamp() });
  await setDoc(userBoardRef(u.uid, id), { name, role: 'owner', ownerName: u.name, joinedAt: serverTimestamp() });
  // batches max out at 500 writes
  const all = [...items.map((it) => [doc(itemsCol(id), it.id), it]), ...strings.map((s) => [doc(stringsCol(id), s.id), s])];
  for (let i = 0; i < all.length; i += 400) {
    const batch = writeBatch(db);
    for (const [r, data] of all.slice(i, i + 400)) batch.set(r, data);
    await batch.commit();
  }
  return id;
}

export async function createInvite(boardId, boardName, role) {
  const u = requireUser();
  const code = makeCode();
  await setDoc(doc(db, 'invites', code), {
    boardId, boardName, role, createdBy: u.uid, createdByName: u.name,
    createdAt: serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + 14 * 864e5),
    active: true,
  });
  return code;
}

export function watchInvites(boardId, cb) {
  return onSnapshot(query(collection(db, 'invites'), where('boardId', '==', boardId)), (snap) => {
    cb(snap.docs.map((d) => ({ code: d.id, ...d.data() })).filter((i) => i.active && i.expiresAt && i.expiresAt.toMillis() > Date.now()));
  }, () => cb([]));
}
export const revokeInvite = (code) => updateDoc(doc(db, 'invites', code), { active: false });

export async function joinByCode(rawCode) {
  const u = requireUser();
  const code = cleanCode(rawCode);
  if (code.length < 6) throw Object.assign(new Error('That code looks too short.'), { code: 'bad-code' });
  const snap = await getDoc(doc(db, 'invites', code));
  if (!snap.exists()) throw Object.assign(new Error('That invite code doesn’t exist.'), { code: 'bad-code' });
  const inv = snap.data();
  if (!inv.active || inv.expiresAt.toMillis() < Date.now()) throw Object.assign(new Error('That invite has expired. Ask for a new one.'), { code: 'expired' });
  const memberRef = doc(membersCol(inv.boardId), u.uid);
  const existing = await getDoc(memberRef).catch(() => null);
  if (!existing || !existing.exists()) {
    await setDoc(memberRef, { role: inv.role, name: u.name, email: u.email || '', invite: code, joinedAt: serverTimestamp() });
  }
  const board = (await getDoc(boardRef(inv.boardId))).data();
  const role = existing && existing.exists() ? existing.data().role : inv.role;
  await setDoc(userBoardRef(u.uid, inv.boardId), { name: board.name, role, ownerName: board.ownerName || '', joinedAt: serverTimestamp() });
  return { id: inv.boardId, name: board.name, bg: board.bg, role, ownerId: board.ownerId, ownerName: board.ownerName };
}

export function watchMyBoards(cb) {
  const u = requireUser();
  return onSnapshot(collection(db, 'users', u.uid, 'boards'), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {});
}

export function watchMembers(boardId, cb) {
  return onSnapshot(membersCol(boardId), (snap) => cb(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))), () => cb([]));
}
export const removeMember = (boardId, uid) => deleteDoc(doc(membersCol(boardId), uid));

export async function leaveBoard(boardId) {
  const u = requireUser();
  await deleteDoc(doc(membersCol(boardId), u.uid)).catch(() => {});
  await deleteDoc(userBoardRef(u.uid, boardId)).catch(() => {});
}
export const forgetBoard = (boardId) => (currentUser ? deleteDoc(userBoardRef(currentUser.uid, boardId)).catch(() => {}) : null);

export async function stopSharing(boardId) {
  const u = requireUser();
  const dels = [];
  for (const col of [itemsCol(boardId), stringsCol(boardId), imagesCol(boardId)]) (await getDocs(col)).forEach((d) => dels.push(d.ref));
  (await getDocs(query(collection(db, 'invites'), where('boardId', '==', boardId)))).forEach((d) => dels.push(d.ref));
  (await getDocs(membersCol(boardId))).forEach((d) => { if (d.id !== u.uid) dels.push(d.ref); });
  for (let i = 0; i < dels.length; i += 400) {
    const batch = writeBatch(db);
    dels.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  await deleteDoc(boardRef(boardId));
  await deleteDoc(doc(membersCol(boardId), u.uid));
  await deleteDoc(userBoardRef(u.uid, boardId)).catch(() => {});
}

// ---------- live sync ----------
// handlers: { onBoard(data), onItems(changes, isFirst), onStrings(changes, isFirst), onLost(err), onMembers(list) }
export function watchBoard(boardId, h) {
  const unsubs = [];
  let lost = false;
  const fail = (e) => {
    if (lost) return;
    if (e && (e.code === 'permission-denied' || e.code === 'not-found')) { lost = true; h.onLost && h.onLost(e); }
  };
  unsubs.push(onSnapshot(boardRef(boardId), (s) => {
    if (!s.exists()) { if (!s.metadata.fromCache) fail({ code: 'not-found' }); return; }
    h.onBoard && h.onBoard(s.data());
  }, fail));
  const sub = (col, cb) => {
    let first = true;
    unsubs.push(onSnapshot(col, { includeMetadataChanges: false }, (snap) => {
      // our own not-yet-confirmed writes are skipped (we already have them locally)
      const changes = snap.docChanges()
        .filter((c) => !c.doc.metadata.hasPendingWrites)
        .map((c) => ({ type: c.type, id: c.doc.id, data: c.doc.data() }));
      if (changes.length || first) cb(changes, first, first ? snap.docs.map((d) => d.id) : null);
      first = false;
    }, fail));
  };
  sub(itemsCol(boardId), (c, f, all) => h.onItems && h.onItems(c, f, all));
  sub(stringsCol(boardId), (c, f, all) => h.onStrings && h.onStrings(c, f, all));
  if (h.onMembers) unsubs.push(onSnapshot(membersCol(boardId), (snap) => h.onMembers(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))), () => {}));
  return () => unsubs.forEach((u) => u());
}

export function writeItem(boardId, item) {
  const u = currentUser;
  return setDoc(doc(itemsCol(boardId), item.id), { ...item, updatedBy: u ? u.uid : null, updatedAt: Date.now() });
}
export const deleteItem = (boardId, id) => deleteDoc(doc(itemsCol(boardId), id));
export const writeString = (boardId, s) => setDoc(doc(stringsCol(boardId), s.id), s);
export const deleteString = (boardId, id) => deleteDoc(doc(stringsCol(boardId), id));
export const updateBoard = (boardId, patch) => updateDoc(boardRef(boardId), { ...patch, updatedAt: serverTimestamp() });
export async function renameMembership(boardId, name) {
  if (!currentUser) return;
  await updateDoc(userBoardRef(currentUser.uid, boardId), { name }).catch(() => {});
}
