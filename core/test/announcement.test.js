const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FARM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'announcement-'));

const store = require('../src/models/store');

test('默认公告为空且启用', () => {
  const announcement = store.getAnnouncement();
  assert.equal(announcement.content, '');
  assert.equal(announcement.enabled, true);
  assert.equal(announcement.showOnce, true);
});

test('setAnnouncement 保存内容并更新时间戳', () => {
  const before = store.getAnnouncement().updatedAt;
  const saved = store.setAnnouncement('  测试公告内容  ', true, true);
  assert.equal(saved.content, '测试公告内容');
  assert.equal(saved.enabled, true);
  assert.equal(saved.showOnce, true);
  assert.ok(saved.updatedAt >= before);
});

test('setAnnouncement 可关闭公告', () => {
  const saved = store.setAnnouncement('关闭的公告', true, false);
  assert.equal(saved.enabled, false);
  assert.equal(saved.content, '关闭的公告');
  store.setAnnouncement('', true, true);
});

test('markAnnouncementRead 记录已读时间', () => {
  const saved = store.setAnnouncement('已读测试', true, true);
  assert.equal(store.getAnnouncementReadRecord('user-x'), 0);
  store.markAnnouncementRead('user-x');
  assert.ok(store.getAnnouncementReadRecord('user-x') >= saved.updatedAt);
});

test('shouldShowAnnouncement 按已读与更新时间判断', () => {
  const saved = store.setAnnouncement('showonce 公告', true, true);
  assert.equal(store.shouldShowAnnouncement('user-a'), true);
  assert.equal(store.shouldShowAnnouncement('other-user'), true);
  store.markAnnouncementRead('user-a');
  assert.equal(store.shouldShowAnnouncement('user-a'), false);
  assert.equal(store.shouldShowAnnouncement('other-user'), true);
  store.setAnnouncement('新公告', true, true);
  assert.notEqual(saved.updatedAt, store.getAnnouncement().updatedAt);
  assert.equal(store.shouldShowAnnouncement('user-a'), true);
});

test('shouldShowAnnouncement 空内容或关闭时不展示', () => {
  store.setAnnouncement('', true, true);
  assert.equal(store.shouldShowAnnouncement('user-a'), false);
  store.setAnnouncement('关闭状态', true, false);
  assert.equal(store.shouldShowAnnouncement('user-a'), false);
  store.setAnnouncement('', true, true);
});

const routes = require('../src/controllers/admin-announcement-routes');

function createMockApp() {
  const handlers = { get: [], post: [], put: [] };
  const app = {
    get: (route, ...args) => handlers.get.push({ route, handlers: args }),
    post: (route, ...args) => handlers.post.push({ route, handlers: args }),
    put: (route, ...args) => handlers.put.push({ route, handlers: args }),
  };
  return { app, handlers };
}

function invoke(handlersList, route, req, res) {
  const entry = handlersList.find(item => item.route === route);
  assert.ok(entry, `未找到路由 ${route}`);
  for (const handler of entry.handlers) {
    const next = () => {};
    handler(req, res, next);
  }
}

function createRes() {
  const body = {};
  return {
    statusCode: 200,
    json(payload) {
      body.payload = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    get payload() {
      return body.payload;
    },
  };
}

test('公开 GET /api/announcement 无需鉴权返回公告', () => {
  store.setAnnouncement('公开公告内容', true, true);
  const { app, handlers } = createMockApp();
  routes.registerAdminAnnouncementRoutes({
    app,
    store,
    logger: { warn() {} },
    requireAdminToken: (req, res, next) => next(),
    requireAdminRole: (req, res, next) => next(),
  });
  const res = createRes();
  invoke(handlers.get, '/api/announcement', {}, res);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.content, '公开公告内容');
});

test('PUT /api/admin/announcement 保存公告且调用鉴权中间件', () => {
  const { app, handlers } = createMockApp();
  const calls = [];
  routes.registerAdminAnnouncementRoutes({
    app,
    store,
    logger: { warn() {} },
    requireAdminToken: (req, res, next) => {
      calls.push('token');
      req.currentUser = { username: 'admin' };
      next();
    },
    requireAdminRole: (req, res, next) => {
      calls.push('role');
      next();
    },
  });
  const res = createRes();
  invoke(handlers.put, '/api/admin/announcement', { body: { content: '管理员公告', showOnce: false, enabled: true } }, res);
  assert.deepEqual(calls, ['token', 'role']);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.content, '管理员公告');
  assert.equal(res.payload.data.showOnce, false);
});

test('POST /api/announcement/read 记录当前用户已读', () => {
  const { app, handlers } = createMockApp();
  routes.registerAdminAnnouncementRoutes({
    app,
    store,
    logger: { warn() {} },
    requireAdminToken: (req, res, next) => {
      req.currentUser = { username: 'reader' };
      next();
    },
    requireAdminRole: (req, res, next) => next(),
  });
  const res = createRes();
  invoke(handlers.post, '/api/announcement/read', {}, res);
  assert.equal(res.payload.ok, true);
  const announcement = store.getAnnouncement();
  assert.ok(store.getAnnouncementReadRecord('reader') >= announcement.updatedAt);
});

test('POST /api/announcement/read 未登录返回 401', () => {
  const { app, handlers } = createMockApp();
  routes.registerAdminAnnouncementRoutes({
    app,
    store,
    logger: { warn() {} },
    requireAdminToken: (req, res, next) => {
      req.currentUser = null;
      next();
    },
    requireAdminRole: (req, res, next) => next(),
  });
  const res = createRes();
  invoke(handlers.post, '/api/announcement/read', {}, res);
  assert.equal(res.payload.ok, false);
  assert.equal(res.payload.error, '未登录');
});
