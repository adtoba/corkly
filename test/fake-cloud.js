// Browser half of a fake CorklyCloud used only by test/sync-test.js. Talks to Node through window.__cloud().
(() => {
  const subs = new Map(); let n = 0; let user = null; const authCbs = [];
  window.__cloudEmit = (id, payload) => { const cb = subs.get(id); if (cb) cb(...payload); };
  const call = (op, ...args) => window.__cloud(op, args);
  const sub = (op, args, cb) => { const id = 's' + (++n); subs.set(id, cb); call('subscribe', id, op, ...args); return () => { subs.delete(id); call('unsubscribe', id); }; };
  const wrapErr = async (p) => { const r = await p; if (r && r.__error) throw Object.assign(new Error(r.message), { code: r.code }); return r; };
  window.CorklyCloud = {
    init: () => true,
    me: () => user,
    onAuth: (cb) => { authCbs.push(cb); setTimeout(() => cb(user), 10); return () => {}; },
    async signUp(email, pw, name) { user = await wrapErr(call('signUp', email, name)); authCbs.forEach((c) => c(user)); return user; },
    async signIn(email) { user = await wrapErr(call('signIn', email)); authCbs.forEach((c) => c(user)); return user; },
    async signOut() { user = null; authCbs.forEach((c) => c(null)); },
    resetPassword: async () => {},
    friendlyError: (e) => (e && e.message) || 'err',
    prettyCode: (c) => `${c.slice(0, 5)}-${c.slice(5)}`,
    saveImage: (b, id, bytes, mime, ratio) => wrapErr(call('saveImage', b, id, Array.from(bytes), mime, ratio)),
    loadImage: async (b, id) => { const r = await wrapErr(call('loadImage', b, id)); return r && { ...r, bytes: new Uint8Array(r.bytes) }; },
    deleteImage: (b, id) => wrapErr(call('deleteImage', b, id)),
    createSharedBoard: (d) => wrapErr(call('createSharedBoard', d)),
    createInvite: (b, name, role) => wrapErr(call('createInvite', b, name, role)),
    watchInvites: (b, cb) => sub('invites', [b], (list) => cb(list.map((i) => ({ ...i, expiresAt: { toDate: () => new Date(i.expiresAt), toMillis: () => i.expiresAt } })))),
    revokeInvite: (c) => wrapErr(call('revokeInvite', c)),
    joinByCode: (c) => wrapErr(call('joinByCode', c)),
    watchMyBoards: (cb) => sub('myBoards', [], cb),
    watchMembers: (b, cb) => sub('members', [b], cb),
    removeMember: (b, uid) => wrapErr(call('removeMember', b, uid)),
    leaveBoard: (b) => wrapErr(call('leaveBoard', b)),
    forgetBoard: async () => {},
    stopSharing: (b) => wrapErr(call('stopSharing', b)),
    watchBoard(b, h) {
      const u1 = sub('board', [b], (kind, ...rest) => {
        if (kind === 'board') h.onBoard && h.onBoard(rest[0]);
        if (kind === 'items') h.onItems && h.onItems(...rest);
        if (kind === 'strings') h.onStrings && h.onStrings(...rest);
        if (kind === 'lost') h.onLost && h.onLost({ code: 'permission-denied' });
      });
      return u1;
    },
    writeItem: (b, item) => wrapErr(call('write', b, 'items', item)),
    deleteItem: (b, id) => wrapErr(call('del', b, 'items', id)),
    writeString: (b, s) => wrapErr(call('write', b, 'strings', s)),
    deleteString: (b, id) => wrapErr(call('del', b, 'strings', id)),
    updateBoard: (b, patch) => wrapErr(call('updateBoard', b, patch)),
    renameMembership: async () => {},
  };
})();
