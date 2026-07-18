import { customAlphabet } from 'nanoid';

const newId = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8);

const sessions = new Map();

export function createSession(hostName) {
  const id = newId();
  sessions.set(id, {
    id,
    host: { name: hostName, socket: null, finalScore: null },
    guest: null,
    guest2: null,
    status: 'waiting',
    seed: null,
    createdAt: Date.now(),
    vibeModes: { host: 'random', guest: 'random', guest2: 'random' },
  });
  return id;
}

export function getSession(id) {
  return sessions.get(id);
}

export function attachSocket(id, role, socket, name) {
  const s = sessions.get(id);
  if (!s) return null;
  if (role === 'host') {
    s.host.socket = socket;
    if (name) s.host.name = name;
  } else if (role === 'guest2') {
    s.guest2 = { name, socket, finalScore: null };
  } else {
    s.guest = { name, socket, finalScore: null };
  }
  return s;
}

export function detachSocket(id, socket) {
  const s = sessions.get(id);
  if (!s) return;
  if (s.host?.socket === socket) s.host.socket = null;
  if (s.guest?.socket === socket) s.guest = null;
  if (s.guest2?.socket === socket) s.guest2 = null;
  if (!s.host?.socket && !s.guest?.socket && !s.guest2?.socket) {
    sessions.delete(id);
  }
}

export function lobbySnapshot(s) {
  return {
    type: 'lobby',
    host: s.host ? { name: s.host.name } : null,
    guest: s.guest ? { name: s.guest.name } : null,
    guest2: s.guest2 ? { name: s.guest2.name } : null,
    vibeModes: s.vibeModes,
  };
}

export function purgeStaleSessions() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff && !s.host?.socket && !s.guest?.socket && !s.guest2?.socket) {
      sessions.delete(id);
    }
  }
}

export function broadcast(s, msg, exceptSocket = null) {
  const json = JSON.stringify(msg);
  if (s.host?.socket && s.host.socket !== exceptSocket && s.host.socket.readyState === 1) {
    s.host.socket.send(json);
  }
  if (s.guest?.socket && s.guest.socket !== exceptSocket && s.guest.socket.readyState === 1) {
    s.guest.socket.send(json);
  }
  if (s.guest2?.socket && s.guest2.socket !== exceptSocket && s.guest2.socket.readyState === 1) {
    s.guest2.socket.send(json);
  }
}
