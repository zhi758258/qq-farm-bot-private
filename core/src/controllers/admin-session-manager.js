const crypto = require('node:crypto');

function createAdminSessionManager({ logger: _logger, getIo, userStore }) {
  const adminTokens = new Set();
  const adminSessions = new Map();

  function generateAdminToken() {
    return crypto.randomBytes(24).toString('hex');
  }

  function sendUnauthorized(res) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized',
    });
  }

  function createAdminSession(user) {
    const token = generateAdminToken();
    adminTokens.add(token);
    adminSessions.set(token, user);
    return token;
  }

  function invalidateAdminSession(token) {
    adminTokens.delete(token);
    adminSessions.delete(token);
  }

  function disconnectAdminTokenSockets(token) {
    const io = typeof getIo === 'function' ? getIo() : null;
    if (!io) return;
    for (const socket of io.sockets.sockets.values()) {
      String(socket.data.adminToken || '') === String(token)
        && socket.disconnect(true);
    }
  }

  function invalidateAdminSessionAndDisconnect(token) {
    invalidateAdminSession(token);
    disconnectAdminTokenSockets(token);
  }

  function invalidateAdminSessions(predicate) {
    for (const [token, session] of adminSessions.entries()) {
      if (predicate(session, token))
        invalidateAdminSessionAndDisconnect(token);
    }
  }

  function updateAdminSessions(predicate, updateSession) {
    for (const [token, session] of adminSessions.entries()) {
      if (predicate(session, token)) {
        updateSession(session, token);
        adminSessions.set(token, session);
      }
    }
  }

  function refreshSessionFromStore(session) {
    if (!userStore || typeof userStore.getUser !== "function") return session;
    if (!session || !session.username) return session;
    const fresh = userStore.getUser(session.username);
    if (!fresh) return null;
    return {
      ...session,
      username: fresh.username,
      role: fresh.role,
      accountLimit: fresh.accountLimit,
      card: fresh.card,
    };
  }

  function requireAdminToken(req, res, next) {
    const token = req.headers['x-admin-token'];
    if (!token || !adminTokens.has(token))
      return sendUnauthorized(res);
    let session = adminSessions.get(token);

    if (userStore && typeof userStore.getUser === "function") {
      session = refreshSessionFromStore(session);
      if (!session) {
        invalidateAdminSessionAndDisconnect(token);
        return sendUnauthorized(res);
      }
      const elevated = session.role === "admin" || session.role === "super_admin";
      if (!elevated && session.card) {
        if (session.card.enabled === false) {
          invalidateAdminSessionAndDisconnect(token);
          return res.status(403).json({
            ok: false,
            error: '账号已被封禁',
            code: 'BANNED',
          });
        }
        if (
          session.card.expiresAt
          && new Date(session.card.expiresAt).getTime() < Date.now()
        ) {
          invalidateAdminSessionAndDisconnect(token);
          return res.status(403).json({
            ok: false,
            error: '账号已过期，请续费',
            code: 'EXPIRED',
          });
        }
      }
      adminSessions.set(token, session);
    }

    req.adminToken = token;
    req.currentUser = session;
    next();
  }

  function cleanupInvalidAdminSessions() {
    if (!userStore || typeof userStore.getUser !== "function") return;
    for (const [token, session] of adminSessions.entries()) {
      if (!session || !session.username) continue;
      const fresh = userStore.getUser(session.username);
      if (!fresh) {
        invalidateAdminSessionAndDisconnect(token);
        continue;
      }
      const elevated = fresh.role === "admin" || fresh.role === "super_admin";
      if (!elevated && fresh.card) {
        if (
          fresh.card.enabled === false
          || (
            fresh.card.expiresAt
            && new Date(fresh.card.expiresAt).getTime() < Date.now()
          )
        ) {
          invalidateAdminSessionAndDisconnect(token);
        }
      }
    }
  }

  function hasToken(token) {
    return adminTokens.has(token);
  }

  function getSession(token) {
    return adminSessions.get(token) || null;
  }

  return {
    cleanupInvalidAdminSessions,
    createAdminSession,
    getSession,
    hasToken,
    invalidateAdminSessionAndDisconnect,
    invalidateAdminSessions,
    requireAdminToken,
    updateAdminSessions,
  };
}

module.exports = {
  createAdminSessionManager,
};
