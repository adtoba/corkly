// Node half of the fake cloud: in-memory boards + the same role rules as firebase/firestore.rules.
module.exports = function createFakeServer() {
  const users = {}; const boards = {}; const invites = {}; const myBoards = {};
  const subs = []; // {page, id, op, args, uid}
  let seq = 0;
  const err = (code, message) => ({ __error: true, code, message: message || code });
  const role = (b, uid) => boards[b] && boards[b].members[uid] && boards[b].members[uid].role;
  const emit = (filter, payloadFn, exceptPage) => {
    for (const s of subs) if (filter(s) && s.page !== exceptPage) s.page.evaluate(([id, p]) => window.__cloudEmit(id, p), [s.id, payloadFn(s)]).catch(() => {});
  };
  const emitBoard = (b, kind, changes, exceptPage) => emit((s) => s.op === 'board' && s.args[0] === b, () => [kind, changes, false, null], exceptPage);
  const emitMembers = (b) => emit((s) => s.op === 'members' && s.args[0] === b, () => [Object.entries(boards[b] ? boards[b].members : {}).map(([uid, m]) => ({ uid, ...m }))]);
  const emitMy = (uid) => emit((s) => s.op === 'myBoards' && s.uid === uid, () => [Object.entries(myBoards[uid] || {}).map(([id, v]) => ({ id, ...v }))]);
  const emitInv = (b) => emit((s) => s.op === 'invites' && s.args[0] === b, () => [Object.entries(invites).filter(([, i]) => i.boardId === b && i.active).map(([code, i]) => ({ code, ...i }))]);

  function handler(page, state) {
    return async (op, args) => {
      const uid = state.user && state.user.uid;
      switch (op) {
        case 'signUp': { const [email, name] = args; const u = { uid: 'u' + (++seq), email, name }; users[email] = u; state.user = u; return u; }
        case 'signIn': { const u = users[args[0]]; if (!u) return err('auth/user-not-found'); state.user = u; return u; }
        case 'subscribe': {
          const [id, kind, ...rest] = args; const s = { page, id, op: kind, args: rest, uid }; subs.push(s);
          if (kind === 'board') {
            const b = rest[0]; const bd = boards[b];
            if (!bd || !bd.members[uid]) { setTimeout(() => page.evaluate(([i]) => window.__cloudEmit(i, ['lost']), [id]).catch(() => {}), 20); return true; }
            setTimeout(async () => {
              const ev = (p) => page.evaluate(([i, x]) => window.__cloudEmit(i, x), [id, p]).catch(() => {});
              await ev(['board', { name: bd.name, bg: bd.bg, ownerName: bd.ownerName }]);
              await ev(['items', Object.values(bd.items).map((d) => ({ type: 'added', id: d.id, data: d })), true, Object.keys(bd.items)]);
              await ev(['strings', Object.values(bd.strings).map((d) => ({ type: 'added', id: d.id, data: d })), true, Object.keys(bd.strings)]);
            }, 20);
          }
          if (kind === 'members') setTimeout(() => emitMembers(rest[0]), 10);
          if (kind === 'myBoards') setTimeout(() => emitMy(uid), 10);
          if (kind === 'invites') setTimeout(() => emitInv(rest[0]), 10);
          return true;
        }
        case 'unsubscribe': { const i = subs.findIndex((s) => s.id === args[0] && s.page === page); if (i >= 0) subs.splice(i, 1); return true; }
        case 'createSharedBoard': {
          const id = 'b' + (++seq); const d = args[0];
          boards[id] = { name: d.name, bg: d.bg, ownerId: uid, ownerName: state.user.name, members: { [uid]: { role: 'owner', name: state.user.name } }, items: {}, strings: {}, images: {} };
          (myBoards[uid] = myBoards[uid] || {})[id] = { name: d.name, role: 'owner' };
          return id;
        }
        case 'createInvite': { const [b, name, r] = args; if (role(b, uid) !== 'owner') return err('permission-denied'); const code = 'CODE' + (++seq) + 'XYZW'; invites[code] = { boardId: b, boardName: name, role: r, active: true, expiresAt: Date.now() + 14 * 864e5 }; emitInv(b); return code; }
        case 'revokeInvite': { const i = invites[args[0]]; if (i) { i.active = false; emitInv(i.boardId); } return true; }
        case 'joinByCode': {
          const code = String(args[0]).toUpperCase().replace(/[^A-Z0-9]/g, ''); const inv = invites[code];
          if (!inv || !inv.active) return err('bad-code', 'That invite code doesn’t exist.');
          const bd = boards[inv.boardId];
          if (!bd.members[uid]) bd.members[uid] = { role: inv.role, name: state.user.name };
          (myBoards[uid] = myBoards[uid] || {})[inv.boardId] = { name: bd.name, role: bd.members[uid].role, ownerName: bd.ownerName };
          emitMembers(inv.boardId);
          return { id: inv.boardId, name: bd.name, bg: bd.bg, role: bd.members[uid].role, ownerName: bd.ownerName };
        }
        case 'removeMember': { const [b, u] = args; if (role(b, uid) !== 'owner') return err('permission-denied'); delete boards[b].members[u]; emitMembers(b); emit((s) => s.op === 'board' && s.args[0] === b && s.uid === u, () => ['lost']); return true; }
        case 'leaveBoard': { delete boards[args[0]].members[uid]; emitMembers(args[0]); return true; }
        case 'stopSharing': { const b = args[0]; if (role(b, uid) !== 'owner') return err('permission-denied'); emit((s) => s.op === 'board' && s.args[0] === b && s.uid !== uid, () => ['lost']); delete boards[b]; return true; }
        case 'saveImage': { const [b, id, bytes, mime, ratio] = args; if (!role(b, uid)) return err('permission-denied'); if (bytes.length >= 1000000) return err('permission-denied', 'too big'); boards[b].images[id] = { bytes, mime, ratio, authorId: uid }; return id; }
        case 'loadImage': { const [b, id] = args; if (!role(b, uid)) return err('permission-denied'); return boards[b].images[id] || null; }
        case 'deleteImage': { const [b, id] = args; if (boards[b]) delete boards[b].images[id]; return true; }
        case 'updateBoard': { const [b, patch] = args; const r = role(b, uid); if (!r || r === 'pin') return err('permission-denied'); Object.assign(boards[b], patch); emitBoard(b, 'board', { name: boards[b].name, bg: boards[b].bg, ownerName: boards[b].ownerName }, page); return true; }
        case 'write': {
          const [b, col, d] = args; const r = role(b, uid); const bd = boards[b];
          if (!r) return err('permission-denied');
          const prev = bd[col][d.id];
          if (!prev && d.authorId !== uid) return err('permission-denied', 'create must be own');
          if (prev && (d.authorId !== prev.authorId || (r === 'pin' && prev.authorId !== uid))) return err('permission-denied', 'update not allowed');
          bd[col][d.id] = d;
          emitBoard(b, col, [{ type: prev ? 'modified' : 'added', id: d.id, data: d }], page);
          return true;
        }
        case 'del': {
          const [b, col, id] = args; const r = role(b, uid); const bd = boards[b]; const prev = bd && bd[col][id];
          if (!prev) return true;
          if (!r || (r === 'pin' && prev.authorId !== uid)) return err('permission-denied');
          delete bd[col][id];
          emitBoard(b, col, [{ type: 'removed', id, data: prev }], page);
          return true;
        }
      }
      return err('unknown-op', op);
    };
  }
  return { handler, boards, invites };
};
