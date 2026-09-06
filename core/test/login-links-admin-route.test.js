const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FARM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'login-links-test-'));

const store = require('../src/models/store');
const routes = require('../src/controllers/admin-system-routes');

function createMockApp() {
  const handlers = { get: [], post: [], put: [], delete: [] };
  const app = {
    get: (route, ...args) => handlers.get.push({ route, handlers: args }),
    post: (route, ...args) => handlers.post.push({ route, handlers: args }),
    put: (route, ...args) => handlers.put.push({ route, handlers: args }),
    delete: (route, ...args) => handlers.delete.push({ route, handlers: args }),
  };
  return { app, handlers };
}

async function invoke(handlersList, route, req) {
  const entry = handlersList.find((item) => item.route === route);
  assert.ok(entry, `未找到路由 ${route}`);
  const res = {
    statusCode: 200,
    payload: null,
    json(payload) {
      this.payload = payload;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
  for (const handler of entry.handlers) {
    await handler(req, res, () => {});
  }
  return res;
}

const handlers = (() => {
  const { app, handlers: h } = createMockApp();
  routes.registerAdminSystemRoutes({
    app,
    store,
    logger: { warn() {}, info() {}, error() {} },
    requireAdminToken: (req, res, next) => {
      req.currentUser = { username: '283405278', role: 'super_admin' };
      next();
    },
    requireAdminRole: (req, res, next) => next(),
    requireSuperAdminRole: (req, res, next) => next(),
    requireDangerConfirmation: () => true,
    getDefaultSystemConfig: () => ({}),
    getRuntimeConfig: () => ({}),
    updateRuntimeConfig: () => {},
  });
  return h;
})();

function adminReq(overrides = {}) {
  return { currentUser: { username: '283405278' }, body: {}, ...overrides };
}

test('GET /api/admin/login-links 返回默认登录页链接', async () => {
  const res = await invoke(handlers.get, '/api/admin/login-links', adminReq());
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.title, 'QQ农场智能助手');
  assert.equal(res.payload.data.qqGroupUrl, '');
  assert.equal(res.payload.data.purchaseUrl, '');
});

test('POST /api/admin/login-links 保存加群链接与购买地址', async () => {
  const res = await invoke(handlers.post, '/api/admin/login-links', adminReq({
    body: {
      logoUrl: '',
      title: '我的农场助手',
      loginSubtitle: '欢迎回来',
      registerSubtitle: '注册开始',
      purchaseUrl: 'https://buy.example.com/farm',
      qqGroupUrl: 'https://qun.qq.com/qqweb/m/qun/confirm?_wv=3&key=abc',
    },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.title, '我的农场助手');
  assert.equal(res.payload.data.qqGroupUrl, 'https://qun.qq.com/qqweb/m/qun/confirm?_wv=3&key=abc');
  assert.equal(res.payload.data.purchaseUrl, 'https://buy.example.com/farm');
});

test('POST /api/admin/login-links 拒绝非 http(s) 加群链接', async () => {
  const res = await invoke(handlers.post, '/api/admin/login-links', adminReq({
    body: { qqGroupUrl: 'javascript:alert(1)' },
  }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.ok, false);
  assert.match(res.payload.error, /加QQ群链接/);
});

test('POST /api/admin/login-links 拒绝非 http(s) 图标地址', async () => {
  const res = await invoke(handlers.post, '/api/admin/login-links', adminReq({
    body: { logoUrl: 'ftp://img.example.com/logo.png' },
  }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.ok, false);
  assert.match(res.payload.error, /登录图标/);
});

test('POST /api/admin/login-links 允许站内图标路径', async () => {
  const res = await invoke(handlers.post, '/api/admin/login-links', adminReq({
    body: { logoUrl: '/login-assets/abc.png', title: '站内图标' },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.logoUrl, '/login-assets/abc.png');
});

test('POST /api/admin/login-links/reset 恢复默认值', async () => {
  const res = await invoke(handlers.post, '/api/admin/login-links/reset', adminReq());
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.title, 'QQ农场智能助手');
  assert.equal(res.payload.data.qqGroupUrl, '');
  assert.equal(res.payload.data.purchaseUrl, '');
  assert.equal(res.payload.data.logoUrl, '');
});

test('GET /api/admin/login-links 重置后读取仍为默认值', async () => {
  const res = await invoke(handlers.get, '/api/admin/login-links', adminReq());
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.title, 'QQ农场智能助手');
  assert.equal(res.payload.data.qqGroupUrl, '');
});
