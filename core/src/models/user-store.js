/**
 * 用户系统数据模型
 *
 * 聚合了用户、卡密、登录安全（哈希/锁定/限流/日志）与免费卡密领取，
 * 数据以 JSON 文件持久化在 data 目录下。
 *
 * 数据文件：
 *   - users.json           用户列表
 *   - cards.json           卡密列表
 *   - login-attempts.json  登录失败尝试记录
 *   - login-logs.json      登录日志
 *   - card-claim.json      免费卡密领取配置与记录
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');

/* ------------------------------------------------------------------------- *
 * 常量
 * ------------------------------------------------------------------------- */

const USERS_FILE = 'users.json';
const CARDS_FILE = 'cards.json';
const LOGIN_ATTEMPTS_FILE = 'login-attempts.json';
const LOGIN_LOGS_FILE = 'login-logs.json';
const USERNAME_RE = /^\w{3,32}$/;
const QQ_RE = /^\d{5,11}$/;
const CLAIM_FILE = 'card-claim.json';

const DEFAULT_ACCOUNT_LIMIT = 2;
const DEFAULT_ADMIN = { username: '283405278', password: 'hai232658' };
const RESERVED_USERNAMES = ['admin'];

const SALT_LENGTH = 32;
const ITERATIONS = 100000;
const KEY_LENGTH = 64;
const HASH_DIGEST = 'sha512';

const LOGIN_MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 10;

const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 32;

const DAY_MS = 24 * 60 * 60 * 1000;

const LETTERS_RE = /[a-z]/i;
const DIGITS_RE = /\d/;
const SYMBOLS_RE = /[^a-z0-9]/i;

function normalizeCardType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'quota') return 'quota';
  return 'time';
}

/* ------------------------------------------------------------------------- *
 * 基础文件读写工具
 * ------------------------------------------------------------------------- */

function readJsonFile(file) {
  const dataFile = getDataFile(file);
  if (!fs.existsSync(dataFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonFile(file, data) {
  ensureDataDir();
  const dataFile = getDataFile(file);
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeQq(value) {
  const qq = String(value ?? '').trim();
  if (!qq) return { ok: false, error: 'QQ号不能为空' };
  if (!QQ_RE.test(qq)) return { ok: false, error: 'QQ号格式不正确，应为5-11位数字' };
  return { ok: true, data: qq };
}

function getClientIp(req) {
  const xff = req && req.headers && req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    const first = xff.split(',')[0].trim();
    if (first) return first;
  }
  if (req && req.ip) return req.ip;
  if (req && req.socket && req.socket.remoteAddress) return req.socket.remoteAddress;
  return '';
}

function generateUniqueId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

/* ------------------------------------------------------------------------- *
 * 密码哈希（PBKDF2）
 * ------------------------------------------------------------------------- */

function hashPassword(password, salt) {
  const saltBuffer = salt
    ? Buffer.from(salt, 'hex')
    : crypto.randomBytes(SALT_LENGTH);
  const derivedKey = crypto.pbkdf2Sync(
    password,
    saltBuffer,
    ITERATIONS,
    KEY_LENGTH,
    HASH_DIGEST,
  );
  return {
    salt: saltBuffer.toString('hex'),
    hash: derivedKey.toString('hex'),
  };
}

function verifyPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) return false;
  const { hash } = hashPassword(password, salt);
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(hash, 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function passwordStrength(password) {
  const str = String(password || '');
  const score = Math.min(
    Math.max(
      Math.floor((str.length - MIN_PASSWORD_LENGTH) / 5) + 1,
      1,
    ),
    4,
  );
  const hasLetters = LETTERS_RE.test(str);
  const hasNumbers = DIGITS_RE.test(str);
  const hasSymbols = SYMBOLS_RE.test(str);
  let message = '';
  if (str.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, score, message: `密码长度至少 ${MIN_PASSWORD_LENGTH} 位` };
  }
  if (str.length > MAX_PASSWORD_LENGTH) {
    return { valid: false, score, message: `密码长度不能超过 ${MAX_PASSWORD_LENGTH} 位` };
  }
  const variety = (hasLetters ? 1 : 0) + (hasNumbers ? 1 : 0) + (hasSymbols ? 1 : 0);
  if (variety === 1) {
    message = '密码强度较弱，建议包含数字和字母';
    return { valid: true, score: 1, message };
  }
  if (variety === 2) {
    message = '密码强度中等';
    return { valid: true, score: 2, message };
  }
  message = '密码强度较高';
  return { valid: true, score: 3, message };
}

/* ------------------------------------------------------------------------- *
 * 登录尝试 / 锁定 / 限流
 * ------------------------------------------------------------------------- */

function loadLoginAttempts() {
  const list = readJsonFile(LOGIN_ATTEMPTS_FILE);
  return Array.isArray(list) ? list : [];
}

function saveLoginAttempts(list) {
  writeJsonFile(LOGIN_ATTEMPTS_FILE, list);
}

function initializeLoginAttempts() {
  const attempts = loadLoginAttempts();
  const now = Date.now();
  const active = attempts.filter(
    (a) => now - new Date(a.lastAttemptAt).getTime() < LOCK_DURATION_MS,
  );
  saveLoginAttempts(active);
}

function findLoginAttempt(username) {
  const list = loadLoginAttempts();
  const normalized = String(username || '').trim().toLowerCase();
  return list.find((a) => String(a.username || '').toLowerCase() === normalized) || null;
}

function resetLoginAttempts(username) {
  const list = loadLoginAttempts();
  const normalized = String(username || '').trim().toLowerCase();
  const next = list.filter((a) => String(a.username || '').toLowerCase() !== normalized);
  saveLoginAttempts(next);
}

function checkAccountLockout(username) {
  const attempt = findLoginAttempt(username);
  if (!attempt) return { locked: false, remainingAttempts: LOGIN_MAX_ATTEMPTS, lockRemainingMs: 0 };
  const now = Date.now();
  const lastAt = new Date(attempt.lastAttemptAt).getTime();
  const lockRemainingMs = lastAt + LOCK_DURATION_MS - now;
  if (lockRemainingMs > 0 && attempt.failedCount >= LOGIN_MAX_ATTEMPTS) {
    return {
      locked: true,
      remainingAttempts: 0,
      lockRemainingMs,
    };
  }
  const elapsedMs = now - lastAt;
  const windowSize = LOCK_DURATION_MS;
  if (elapsedMs < windowSize) {
    const attemptsInWindow = attempt.failedCount;
    return {
      locked: false,
      remainingAttempts: Math.max(0, LOGIN_MAX_ATTEMPTS - attemptsInWindow),
      lockRemainingMs: 0,
    };
  }
  resetLoginAttempts(username);
  return { locked: false, remainingAttempts: LOGIN_MAX_ATTEMPTS, lockRemainingMs: 0 };
}

function recordLoginFailure(username, ip, userAgent, reason) {
  const list = loadLoginAttempts();
  const normalized = String(username || '').trim().toLowerCase();
  let entry = list.find((a) => String(a.username || '').toLowerCase() === normalized);
  const now = new Date();
  if (!entry) {
    entry = { username: username || '', failedCount: 0, lastAttemptAt: now.toISOString(), ip, userAgent, reason };
    list.push(entry);
  }
  entry.failedCount += 1;
  entry.lastAttemptAt = now.toISOString();
  entry.ip = ip || entry.ip;
  entry.userAgent = userAgent || entry.userAgent;
  entry.reason = reason || entry.reason;
  saveLoginAttempts(list);
}

function checkLoginRateLimit(_ip) {
  const now = Date.now();
  const list = loadLoginAttempts();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = list.filter((a) => {
    try {
      return new Date(a.lastAttemptAt).getTime() >= cutoff;
    } catch {
      return false;
    }
  });
  const hits = recent.reduce((sum, a) => sum + (a.failedCount || 0), 0);
  return hits >= RATE_LIMIT_MAX;
}

/* ------------------------------------------------------------------------- *
 * 登录日志
 * ------------------------------------------------------------------------- */

function loadLoginLogs() {
  const list = readJsonFile(LOGIN_LOGS_FILE);
  return Array.isArray(list) ? list : [];
}

function saveLoginLogs(list) {
  writeJsonFile(LOGIN_LOGS_FILE, list);
}

function createLoginLogEntry({ username, success, ip, userAgent, reason }) {
  return {
    id: generateUniqueId('log'),
    username: username || '',
    success: !!success,
    ip: ip || '',
    userAgent: userAgent || '',
    reason: reason || '',
    createdAt: nowIso(),
  };
}

function saveLoginLog(entry) {
  const logs = loadLoginLogs();
  logs.push(entry);
  const MAX_LOGS = 2000;
  const trimmed = logs.length > MAX_LOGS ? logs.slice(logs.length - MAX_LOGS) : logs;
  saveLoginLogs(trimmed);
}

function recordLoginAttempt({ username, success, ip, userAgent, reason }) {
  if (success) {
    resetLoginAttempts(username);
  } else {
    recordLoginFailure(username, ip, userAgent, reason);
  }
  const entry = createLoginLogEntry({ username, success, ip, userAgent, reason });
  saveLoginLog(entry);
  return entry;
}

function getLoginLogs() {
  const logs = loadLoginLogs();
  return logs.slice().sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
}

function clearLoginLogs() {
  saveLoginLogs([]);
}

function getRecentLoginLogs(count) {
  return getLoginLogs().slice(0, Number(count) || 20);
}

/* ------------------------------------------------------------------------- *
 * 用户
 * ------------------------------------------------------------------------- */

function loadUsers() {
  const list = readJsonFile(USERS_FILE);
  return Array.isArray(list) ? list : [];
}

function saveUsers(users) {
  writeJsonFile(USERS_FILE, users);
}

function loadCards() {
  const list = readJsonFile(CARDS_FILE);
  return Array.isArray(list) ? list : [];
}

function saveCards(cards) {
  writeJsonFile(CARDS_FILE, cards);
}

function initDefaultAdmin() {
  const users = loadUsers();
  const hasAdmin = users.some(
    (u) => u && u.role === 'super_admin' && u.username === DEFAULT_ADMIN.username,
  );
  if (hasAdmin) return;
  const { salt, hash } = hashPassword(DEFAULT_ADMIN.password);
  users.push({
    username: DEFAULT_ADMIN.username,
    passwordSalt: salt,
    passwordHash: hash,
    role: 'super_admin',
    accountLimit: DEFAULT_ACCOUNT_LIMIT,
    card: null,
    note: '系统管理员',
    mustChangePassword: false,
    createdAt: nowIso(),
  });
  saveUsers(users);
}

/* --- 卡密操作 --- */

function findCardByCode(code) {
  const cards = loadCards();
  const normalized = String(code || '').trim();
  return cards.find((c) => c && String(c.code || '').trim() === normalized) || null;
}

function getOneCard(code) {
  const card = findCardByCode(code);
  if (!card) return null;
  if (card.enabled === false) return null;
  return card;
}

function getOneCardByCode(code) {
  return findCardByCode(code);
}

function getCardInfo(code) {
  const card = findCardByCode(code);
  if (!card) return null;
  return {
    code: card.code,
    type: normalizeCardType(card.type),
    days: card.days || 0,
    status: card.status || 'unused',
    description: card.description || '',
    createdAt: card.createdAt || '',
    usedAt: card.usedAt || '',
    usedBy: card.usedBy || '',
  };
}

function getAllCards() {
  return loadCards().map(card => ({ ...card, type: normalizeCardType(card.type) }));
}

function createCard(payload) {
  const cards = loadCards();
  const code = String((payload && payload.code) || crypto.randomBytes(8).toString('hex')).toUpperCase();
  if (findCardByCode(code)) {
    return { ok: false, error: '卡密已存在' };
  }
  const card = {
    code,
    type: normalizeCardType(payload && payload.type),
    days: Number((payload && payload.days) || 0),
    description: (payload && payload.description) || '',
    status: 'unused',
    enabled: true,
    createdAt: nowIso(),
    usedBy: '',
    usedAt: '',
  };
  cards.push(card);
  saveCards(cards);
  return { ok: true, data: card };
}

function createCardsBatch(count, payload) {
  const total = Math.max(1, Math.min(Number(count) || 1, 500));
  const created = [];
  for (let i = 0; i < total; i += 1) {
    const res = createCard(payload);
    if (res.ok) created.push(res.data);
  }
  return created;
}

function updateCard(code, update) {
  const cards = loadCards();
  const card = cards.find((c) => c && String(c.code || '').trim() === String(code || '').trim());
  if (!card) return { ok: false, error: '卡密不存在' };
  if (update) {
    if (typeof update.type === 'string' && update.type.trim()) card.type = normalizeCardType(update.type);
    if (typeof update.days === 'number') card.days = Math.max(0, update.days);
    if (typeof update.description === 'string') card.description = update.description;
    if (typeof update.enabled === 'boolean') card.enabled = update.enabled;
    if (typeof update.status === 'string' && update.status) card.status = update.status;
  }
  saveCards(cards);
  return { ok: true, data: card };
}

function deleteCard(code) {
  const cards = loadCards();
  const next = cards.filter((c) => !(c && String(c.code || '').trim() === String(code || '').trim()));
  if (next.length === cards.length) return { ok: false, error: '卡密不存在' };
  saveCards(next);
  return { ok: true };
}

function deleteCardsBatch(codes) {
  const list = Array.isArray(codes) ? codes.map((c) => String(c || '').trim()).filter(Boolean) : [];
  const cards = loadCards();
  const set = new Set(list);
  const next = cards.filter((c) => !(c && set.has(String(c.code || '').trim())));
  if (next.length === cards.length) return { ok: false, error: '没有匹配的卡密' };
  saveCards(next);
  return { ok: true, deleted: cards.length - next.length };
}

/* --- 用户操作 --- */

function findUser(username) {
  const users = loadUsers();
  const normalized = String(username || '').trim().toLowerCase();
  return users.find((u) => u && String(u.username || '').toLowerCase() === normalized) || null;
}

function getUser(username) {
  const user = findUser(username);
  if (!user) return null;
  let card = null;
  if (user.cardCode) {
    card = findCardByCode(user.cardCode);
    if (card) card = { ...card, type: normalizeCardType(card.type) };
  }
  return {
    ...user,
    qq: user.qq || '',
    passwordHash: undefined,
    passwordSalt: undefined,
    card,
  };
}

function getUserSnapshot(username) {
  const user = findUser(username);
  if (!user) return null;
  const card = user.cardCode ? findCardByCode(user.cardCode) : null;
  return {
    username: user.username,
    qq: user.qq || '',
    role: user.role,
    accountLimit: user.accountLimit,
    card: {
      enabled: card ? card.enabled !== false : false,
      expiresAt: card ? card.expiresAt || null : null,
      type: card ? normalizeCardType(card.type) : 'none',
      days: card ? card.days || 0 : 0,
    },
  };
}

function getAllUsers() {
  return loadUsers().map((u) => {
    const card = u.cardCode ? findCardByCode(u.cardCode) : null;
    return {
      username: u.username,
      qq: u.qq || '',
      role: u.role,
      accountLimit: u.accountLimit,
      note: u.note || '',
      createdAt: u.createdAt || '',
      card: card
        ? {
            code: card.code,
            type: normalizeCardType(card.type),
            days: card.days || 0,
            description: card.description || '',
            expiresAt: card.expiresAt || '',
            enabled: card.enabled !== false,
            status: card.status || 'unused',
            usedAt: card.usedAt || '',
          }
        : null,
    };
  });
}

function getAllUsersWithPassword() {
  return loadUsers().map((u) => ({
    username: u.username,
    role: u.role,
    accountLimit: u.accountLimit,
    passwordHash: u.passwordHash || '',
    passwordSalt: u.passwordSalt || '',
    createdAt: u.createdAt || '',
  }));
}

/* --- 时间计算 --- */

function safeDateMs(value) {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function daysToMs(days) {
  return Math.max(0, Number(days) || 0) * DAY_MS;
}

function calculateExpiry(baseMs, days) {
  const base = safeDateMs(baseMs) > Date.now() ? safeDateMs(baseMs) : Date.now();
  return new Date(base + daysToMs(days)).toISOString();
}

function registerUserWithCard({ username, password, cardCode, qq }) {
  const normalizedUsername = String(username || '').trim();
  if (!normalizedUsername) return { ok: false, error: '用户名不能为空' };
  if (
    RESERVED_USERNAMES.some(
      (name) => normalizedUsername.toLowerCase() === name.toLowerCase(),
    )
  ) {
    return { ok: false, error: '该用户名不允许注册，请更换' };
  }
  if (findUser(normalizedUsername)) return { ok: false, error: '用户名已存在' };

  const qqCheck = normalizeQq(qq);
  if (!qqCheck.ok) return qqCheck;

  const strength = passwordStrength(password);
  if (!strength.valid) return { ok: false, error: strength.message };

  const card = getOneCard(cardCode);
  if (!card) return { ok: false, error: '卡密不存在或不可用' };
  if (card.status === 'used') return { ok: false, error: '卡密已被使用' };
  if (normalizeCardType(card.type) === 'quota') {
    return { ok: false, error: '注册只能使用时间卡密，额度卡密请登录后在续费中使用' };
  }

  const { salt, hash } = hashPassword(password);
  const expiresAt = Number(card.days) === -1 ? null : calculateExpiry(null, card.days);

  const user = {
    username: normalizedUsername,
    qq: qqCheck.data,
    passwordSalt: salt,
    passwordHash: hash,
    role: 'user',
    accountLimit: DEFAULT_ACCOUNT_LIMIT,
    cardCode: card.code,
    note: '',
    mustChangePassword: false,
    createdAt: nowIso(),
  };
  const users = loadUsers();
  users.push(user);
  saveUsers(users);

  const cards = loadCards();
  const savedCard = cards.find((c) => String(c.code || '').trim() === String(card.code || '').trim());
  if (savedCard) {
    savedCard.status = 'used';
    savedCard.usedBy = normalizedUsername;
    savedCard.usedAt = nowIso();
    savedCard.expiresAt = expiresAt;
    saveCards(cards);
  }

  return { ok: true, data: user };
}

function registerUser({ username, password, cardCode, qq }) {
  return registerUserWithCard({ username, password, cardCode, qq });
}

function renewUser({ username, cardCode }) {
  const user = findUser(username);
  if (!user) return { ok: false, error: '用户不存在' };

  const card = getOneCard(cardCode);
  if (!card) return { ok: false, error: '卡密不存在或不可用' };
  if (card.status === 'used') return { ok: false, error: '卡密已被使用' };

  const cardType = normalizeCardType(card.type);
  const existingCard = user.cardCode ? findCardByCode(user.cardCode) : null;
  let newExpiresAt = existingCard && existingCard.expiresAt ? existingCard.expiresAt : null;
  let boundCard = existingCard;
  if (cardType === 'time' && !user.cardCode) {
    const users = loadUsers();
    const savedUser = users.find(
      (u) => String(u.username || '').toLowerCase() === String(user.username || '').toLowerCase(),
    );
    if (savedUser) {
      savedUser.cardCode = card.code;
      saveUsers(users);
      boundCard = findCardByCode(card.code);
    }
  }

  if (cardType === 'quota') {
    const users = loadUsers();
    const savedUser = users.find(
      (u) => String(u.username || '').toLowerCase() === String(user.username || '').toLowerCase(),
    );
    if (savedUser) {
      const currentLimit = Number(savedUser.accountLimit) > 0 ? Number(savedUser.accountLimit) : DEFAULT_ACCOUNT_LIMIT;
      savedUser.accountLimit = currentLimit + Math.max(0, Number(card.days) || 0);
      saveUsers(users);
    }
  }
  else if (Number(card.days) === -1 || (boundCard && Number(boundCard.days) === -1)) {
    newExpiresAt = null;
  }
  else {
    const baseMs = boundCard && boundCard.expiresAt ? safeDateMs(boundCard.expiresAt) : 0;
    newExpiresAt = calculateExpiry(baseMs, card.days);
  }

  const cards = loadCards();
  const consumedCard = cards.find(
    (c) => String(c.code || '').trim() === String(card.code || '').trim(),
  );
  if (consumedCard) {
    consumedCard.status = 'used';
    consumedCard.usedBy = user.username;
    consumedCard.usedAt = nowIso();
  }
  if (cardType === 'time' && boundCard) {
    const boundIdx = cards.findIndex(
      (c) => String(c.code || '').trim() === String(boundCard.code || '').trim(),
    );
    if (boundIdx >= 0) {
      const bound = cards[boundIdx];
      bound.expiresAt = newExpiresAt;
      if (normalizeCardType(bound.type) === 'time') {
        bound.type = normalizeCardType(card.type);
        bound.days = card.days || bound.days || 0;
        bound.description = card.description || bound.description || '';
      }
    }
  }
  saveCards(cards);

  const updatedCard = loadCards().find(
    (c) => String(c.code || '').trim() === String((boundCard ? boundCard.code : card.code) || '').trim(),
  );
  return {
    ok: true,
    data: {
      username: user.username,
      expiresAt: newExpiresAt,
      cardType,
      card: updatedCard ? { ...updatedCard, type: normalizeCardType(updatedCard.type) } : null,
    },
  };
}

function editUser({ username, update, cardUpdate }) {
  const users = loadUsers();
  const user = users.find((u) => String(u.username || '').toLowerCase() === String(username || '').trim().toLowerCase());
  if (!user) return { ok: false, error: '用户不存在' };

  if (update) {
    if (typeof update.newUsername === 'string' && update.newUsername.trim() && update.newUsername.trim() !== user.username) {
      const newName = update.newUsername.trim();
      if (!USERNAME_RE.test(newName)) {
        return { ok: false, error: '用户名只能包含字母、数字和下划线，长度3-32位' };
      }
      const existingUser = users.find(
        (u) => String(u.username || '').toLowerCase() === newName.toLowerCase(),
      );
      if (existingUser) return { ok: false, error: '用户名已存在' };
      const oldName = user.username;
      user.username = newName;
      const cards = loadCards();
      let cardChanged = false;
      for (const c of cards) {
        if (String(c.usedBy || '').toLowerCase() === String(oldName || '').toLowerCase()) {
          c.usedBy = newName;
          cardChanged = true;
        }
      }
      if (cardChanged) saveCards(cards);
    }
    if (typeof update.password === 'string' && update.password) {
      const strength = passwordStrength(update.password);
      if (!strength.valid) return { ok: false, error: strength.message };
      const { salt, hash } = hashPassword(update.password);
      user.passwordSalt = salt;
      user.passwordHash = hash;
      resetLoginAttempts(user.username);
    }
    if (typeof update.role === 'string' && update.role.trim()) {
      const role = update.role.trim();
      if (['user', 'admin', 'super_admin'].includes(role)) user.role = role;
    }
    if (typeof update.accountLimit === 'number') {
      user.accountLimit = Math.max(0, update.accountLimit);
    }
    if (update.qq !== undefined && update.qq !== null) {
      const qqCheck = normalizeQq(update.qq);
      if (!qqCheck.ok) return { ok: false, error: qqCheck.error };
      user.qq = qqCheck.data;
    }
    if (typeof update.note === 'string') user.note = update.note;
  }

  if (cardUpdate || update) {
    const cards = loadCards();
    const card = user.cardCode
      ? cards.find((c) => String(c.code || '').trim() === String(user.cardCode || '').trim())
      : null;
    if (card) {
      let cardChanged = false;
      if (cardUpdate) {
        if (typeof cardUpdate.enabled === 'boolean') {
          card.enabled = cardUpdate.enabled;
          cardChanged = true;
        }
      }
      if (update) {
        if (update.isPermanent === true) {
          card.days = -1;
          card.expiresAt = null;
          card.enabled = true;
          cardChanged = true;
        }
        else if (update.expiresAt !== undefined) {
          if (update.expiresAt === null) {
            card.days = 0;
            card.expiresAt = null;
            cardChanged = true;
          }
          else {
            const expiresMs = typeof update.expiresAt === 'number'
              ? update.expiresAt
              : new Date(update.expiresAt).getTime();
            if (!Number.isNaN(expiresMs)) {
              const diffMs = expiresMs - Date.now();
              card.expiresAt = new Date(expiresMs).toISOString();
              card.days = diffMs > 0 ? Math.ceil(diffMs / DAY_MS) : 0;
              cardChanged = true;
            }
          }
        }
      }
      if (cardChanged) saveCards(cards);
    }
    else if (user.cardCode) {
      if (cardUpdate && typeof cardUpdate.enabled === 'boolean') {
        const freshCards = loadCards();
        const freshCard = freshCards.find((c) => String(c.code || '').trim() === String(user.cardCode || '').trim());
        if (freshCard) {
          freshCard.enabled = cardUpdate.enabled;
          saveCards(freshCards);
        }
      }
    }
  }

  saveUsers(users);
  return { ok: true, data: getUser(user.username) };
}

function changePassword({ username, oldPassword, newPassword }) {
  const user = findUser(username);
  if (!user) return { ok: false, error: '用户不存在' };
  if (!verifyPassword(oldPassword, user.passwordSalt, user.passwordHash)) {
    return { ok: false, error: '原密码错误' };
  }
  const strength = passwordStrength(newPassword);
  if (!strength.valid) return { ok: false, error: strength.message };
  const { salt, hash } = hashPassword(newPassword);
  const users = loadUsers();
  const savedUser = users.find((u) => String(u.username || '').toLowerCase() === String(username || '').toLowerCase());
  if (savedUser) {
    savedUser.passwordSalt = salt;
    savedUser.passwordHash = hash;
    if (savedUser.mustChangePassword) savedUser.mustChangePassword = false;
    saveUsers(users);
  }
  resetLoginAttempts(username);
  return { ok: true };
}

function deleteUser(username) {
  const normalized = String(username || '').trim();
  const users = loadUsers();
  const user = users.find((u) => String(u.username || '').toLowerCase() === normalized.toLowerCase());
  if (!user) return { ok: false, error: '用户不存在' };

  const userCards = user.cardCode ? [user.cardCode] : [];
  const nextUsers = users.filter((u) => String(u.username || '').toLowerCase() !== normalized.toLowerCase());
  saveUsers(nextUsers);

  if (userCards.length > 0) {
    const cards = loadCards();
    const codeSet = new Set(userCards);
    const nextCards = cards.filter((c) => !(c && codeSet.has(String(c.code || '').trim())));
    saveCards(nextCards);
  }

  return { ok: true };
}

/* --- 用户统计与清理 --- */

function getExpiredUserPredicate(nowMs) {
  return (u) => {
    if (!u || u.role !== 'user') return false;
    const card = u.cardCode ? findCardByCode(u.cardCode) : null;
    if (!card || card.enabled === false) return false;
    const expiresMs = safeDateMs(card.expiresAt);
    if (expiresMs === 0) return false;
    return expiresMs < nowMs;
  };
}

function getUserStats() {
  const users = loadUsers();
  const nowMs = Date.now();
  const stats = { total: users.length, valid: 0, expired: 0, banned: 0, noCard: 0 };
  const expiredUsers = [];
  for (const u of users) {
    if (!u || u.role !== 'user') continue;
    const card = u.cardCode ? findCardByCode(u.cardCode) : null;
    if (!card) {
      stats.noCard += 1;
      stats.banned += 1;
      continue;
    }
    if (card.enabled === false) {
      stats.banned += 1;
      continue;
    }
    const expiresMs = safeDateMs(card.expiresAt);
    if (expiresMs > 0 && expiresMs < nowMs) {
      stats.expired += 1;
      expiredUsers.push({
        username: u.username,
        expiresAt: card.expiresAt,
        createdAt: u.createdAt || '',
      });
    }
    else {
      stats.valid += 1;
    }
  }
  return { ...stats, expiredUsers };
}

function cleanupExpiredUsers({ excludeUsernames, dryRun } = {}) {
  const users = loadUsers();
  const nowMs = Date.now();
  const exclude = new Set(
    (Array.isArray(excludeUsernames) ? excludeUsernames : [])
      .map((n) => String(n || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const isExpired = getExpiredUserPredicate(nowMs);
  const targets = users.filter((u) => !exclude.has(String(u.username || '').trim().toLowerCase()) && isExpired(u));

  if (dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      count: targets.length,
      usernames: targets.map((u) => u.username),
    };
  }

  if (targets.length === 0) {
    return { ok: true, count: 0, usernames: [] };
  }

  const targetNames = new Set(targets.map((u) => String(u.username || '').trim().toLowerCase()));
  const nextUsers = users.filter((u) => !targetNames.has(String(u.username || '').trim().toLowerCase()));
  saveUsers(nextUsers);

  const targetCards = new Set(targets.map((u) => u.cardCode).filter(Boolean));
  if (targetCards.size > 0) {
    const cards = loadCards();
    const nextCards = cards.filter((c) => !(c && targetCards.has(String(c.code || '').trim())));
    saveCards(nextCards);
  }

  return {
    ok: true,
    count: targets.length,
    usernames: targets.map((u) => u.username),
  };
}

function addUser({ username, password, role, accountLimit, note }) {
  const normalizedUsername = String(username || '').trim();
  if (!normalizedUsername) return { ok: false, error: '用户名不能为空' };
  if (findUser(normalizedUsername)) return { ok: false, error: '用户名已存在' };
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `密码长度至少 ${MIN_PASSWORD_LENGTH} 位` };
  }
  const { salt, hash } = hashPassword(password);
  const users = loadUsers();
  users.push({
    username: normalizedUsername,
    passwordSalt: salt,
    passwordHash: hash,
    role: ['user', 'admin', 'super_admin'].includes(role) ? role : 'user',
    accountLimit: Number(accountLimit) > 0 ? Number(accountLimit) : DEFAULT_ACCOUNT_LIMIT,
    cardCode: '',
    note: note || '',
    mustChangePassword: false,
    createdAt: nowIso(),
  });
  saveUsers(users);
  return { ok: true, data: getUser(normalizedUsername) };
}

function addUsers(list) {
  const results = [];
  for (const item of Array.isArray(list) ? list : []) {
    results.push(addUser(item));
  }
  return results;
}

function updateUser(username, update) {
  return editUser({ username, update, cardUpdate: null });
}

function canAddAccount(username, usage) {
  const user = findUser(username);
  if (!user) return { ok: false, error: '用户不存在' };
  const limit = user.accountLimit || DEFAULT_ACCOUNT_LIMIT;
  const current = Number(usage) || 0;
  if (current >= limit) {
    return {
      ok: false,
      error: `已达到账号数量上限(${limit})，请联系管理员提升配额`,
      usage: current,
      limit,
    };
  }
  return { ok: true, usage: current, limit };
}

/* ------------------------------------------------------------------------- *
 * 免费卡密领取
 * ------------------------------------------------------------------------- */

function loadClaimStatus() {
  const data = readJsonFile(CLAIM_FILE);
  if (!data) return null;
  return data.status || null;
}

function loadClaimRecords() {
  const data = readJsonFile(CLAIM_FILE);
  if (!data) return null;
  return Array.isArray(data.records) ? data.records : [];
}

function saveClaimData(status, records) {
  writeJsonFile(CLAIM_FILE, { status, records });
}

function getCardClaimStatus() {
  const status = loadClaimStatus();
  return status;
}

function setCardClaimStatus(status) {
  const records = loadClaimRecords() || [];
  saveClaimData(status, records);
  return { ok: true };
}

function claimCardByUA(ua) {
  const status = loadClaimStatus();
  if (!status || !status.enabled) {
    return { ok: false, error: '当前未开启免费卡密领取' };
  }
  if (status.type === 'card') {
    let card = null;
    if (status.cardCode) {
      card = getOneCard(status.cardCode);
    }
    if (!card) {
      card = loadCards().find(c => c && normalizeCardType(c.type) === 'time' && c.enabled !== false && (!c.status || c.status === 'unused') && !c.usedBy) || null;
    }
    if (!card) return { ok: false, error: '卡密不存在或不可用' };
    if (card.status === 'used') return { ok: false, error: '卡密已被领取' };
    const records = loadClaimRecords() || [];
    records.push({
      id: generateUniqueId('claim'),
      ua,
      cardCode: card.code,
      type: normalizeCardType(card.type),
      days: card.days || 0,
      createdAt: nowIso(),
    });
    saveClaimData(status, records);
    return {
      ok: true,
      data: { cardCode: card.code, type: normalizeCardType(card.type), days: card.days },
    };
  }
  return { ok: false, error: '不支持的领取方式' };
}

function getCardClaimRecords() {
  return loadClaimRecords() || [];
}

function clearExpiredClaimRecords() {
  const status = loadClaimStatus();
  const records = loadClaimRecords() || [];
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  const active = records.filter((r) => {
    try {
      return new Date(r.createdAt).getTime() >= cutoff;
    } catch {
      return false;
    }
  });
  saveClaimData(status, active);
  return active;
}

/* ------------------------------------------------------------------------- *
 * 初始化与导出
 * ------------------------------------------------------------------------- */

initializeLoginAttempts();
initDefaultAdmin();

module.exports = {
  DEFAULT_ACCOUNT_LIMIT,
  // auth / 安全
  hashPassword,
  verifyPassword,
  passwordStrength,
  checkLoginRateLimit,
  checkAccountLockout,
  recordLoginAttempt,
  getLoginLogs,
  clearLoginLogs,
  getRecentLoginLogs,
  getClientIp,
  findLoginAttempt,
  // 用户
  getUser,
  getUserSnapshot,
  getAllUsers,
  getAllUsersWithPassword,
  findUser,
  normalizeQq,
  canAddAccount,
  registerUser,
  renewUser,
  editUser,
  changePassword,
  deleteUser,
  getUserStats,
  cleanupExpiredUsers,
  addUser,
  addUsers,
  updateUser,
  initDefaultAdmin,
  // 卡密
  getOneCard,
  getOneCardByCode,
  getCardInfo,
  getAllCards,
  createCard,
  createCardsBatch,
  updateCard,
  deleteCard,
  deleteCardsBatch,
  // 卡密领取
  getCardClaimStatus,
  setCardClaimStatus,
  claimCardByUA,
  getCardClaimRecords,
  clearExpiredClaimRecords,
  // 默认管理员信息（只读，勿修改）
  defaultAdmin: DEFAULT_ADMIN,
};
