const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.FARM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'group-verify-test-'));

const store = require('../src/models/store');
const routes = require('../src/controllers/admin-system-routes');

const mockState = { status: 200, body: JSON.stringify({ ok: true, data: { inGroup: true } }), lastQuery: '' };
const mockServer = http.createServer((req, res) => {
  mockState.lastQuery = req.url || '';
  res.writeHead(mockState.status, { 'Content-Type': 'application/json' });
  res.end(mockState.body);
});

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

async function invoke(handlersList, route, req, res) {
  const entry = handlersList.find((item) => item.route === route);
  assert.ok(entry, `未找到路由 ${route}`);
  for (const handler of entry.handlers) {
    await handler(req, res, () => {});
  }
}

function createRes() {
  return {
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
}

function registerRoutes() {
  const { app, handlers } = createMockApp();
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
  return handlers;
}

test.before(async () => {
  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
});

test.after(() => {
  mockServer.close();
});

test('POST /api/admin/group-verify/test 缺少QQ号返回400', async () => {
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.post, '/api/admin/group-verify/test', { body: {}, currentUser: { username: '283405278' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.ok, false);
  assert.match(res.payload.error, /QQ号/);
});

test('POST /api/admin/group-verify/test 非法QQ号返回400', async () => {
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.post, '/api/admin/group-verify/test', { body: { qq: 'abc12' }, currentUser: { username: '283405278' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.ok, false);
});

test('POST /api/admin/group-verify/test 未配置验证接口返回400', async () => {
  store.setGroupVerifyConfig({ enabled: false, verifyUrl: '' });
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.post, '/api/admin/group-verify/test', { body: { qq: '10000001' }, currentUser: { username: '283405278' } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.payload.error, /验证接口地址/);
});

test('POST /api/admin/group-verify/test 在群时返回成功诊断', async () => {
  const port = mockServer.address().port;
  store.setGroupVerifyConfig({
    enabled: true,
    qqGroupNumber: '123456789',
    verifyUrl: `http://127.0.0.1:${port}/check`,
    verifyToken: '',
    timeoutMs: 3000,
  });
  mockState.status = 200;
  mockState.body = JSON.stringify({ ok: true, data: { inGroup: true } });
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.post, '/api/admin/group-verify/test', { body: { qq: '10000001' }, currentUser: { username: '283405278' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.equal(res.payload.data.inGroup, true);
  assert.equal(res.payload.data.error, '');
  assert.equal(res.payload.data.httpStatus, 200);
  assert.equal(typeof res.payload.data.durationMs, 'number');
  assert.ok(res.payload.data.requestUrl.includes(`qq=10000001`));
  assert.ok(res.payload.data.requestUrl.includes(`group=123456789`));
  assert.equal(mockState.lastQuery.includes('qq=10000001'), true);
});

test('POST /api/admin/group-verify/test 兼容data.inGroup响应', async () => {
  const port = mockServer.address().port;
  store.setGroupVerifyConfig({ enabled: true, verifyUrl: `http://127.0.0.1:${port}/check`, timeoutMs: 3000 });
  mockState.status = 200;
  mockState.body = JSON.stringify({ data: { inGroup: true } });
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.post, '/api/admin/group-verify/test', { body: { qq: '10000002' }, currentUser: { username: '283405278' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.inGroup, true);
});

test('POST /api/admin/group-verify/test 不在群时返回not_in_group与响应体', async () => {
  const port = mockServer.address().port;
  store.setGroupVerifyConfig({ enabled: true, verifyUrl: `http://127.0.0.1:${port}/check`, timeoutMs: 3000 });
  mockState.status = 200;
  mockState.body = JSON.stringify({ inGroup: false });
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.post, '/api/admin/group-verify/test', { body: { qq: '10000003' }, currentUser: { username: '283405278' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.inGroup, false);
  assert.equal(res.payload.data.error, 'not_in_group');
  assert.deepEqual(res.payload.data.responseBody, { inGroup: false });
});

test('POST /api/admin/group-verify/test 接口HTTP错误返回service_unavailable', async () => {
  const port = mockServer.address().port;
  store.setGroupVerifyConfig({ enabled: true, verifyUrl: `http://127.0.0.1:${port}/check`, timeoutMs: 3000 });
  mockState.status = 502;
  mockState.body = 'bad gateway';
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.post, '/api/admin/group-verify/test', { body: { qq: '10000004' }, currentUser: { username: '283405278' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.inGroup, false);
  assert.equal(res.payload.data.error, 'service_unavailable');
  assert.equal(res.payload.data.httpStatus, 502);
});

test('POST /api/admin/group-verify/test 非JSON响应返回invalid_response', async () => {
  const port = mockServer.address().port;
  store.setGroupVerifyConfig({ enabled: true, verifyUrl: `http://127.0.0.1:${port}/check`, timeoutMs: 3000 });
  mockState.status = 200;
  mockState.body = '<html>not json</html>';
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.post, '/api/admin/group-verify/test', { body: { qq: '10000005' }, currentUser: { username: '283405278' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.error, 'invalid_response');
  assert.match(res.payload.data.responseBody, /not json/);
});

test('POST /api/admin/group-verify/test 服务不可达返回service_unavailable', async () => {
  store.setGroupVerifyConfig({ enabled: true, verifyUrl: 'http://127.0.0.1:1/check', timeoutMs: 1500 });
  const handlers = registerRoutes();
  const res = createRes();
  await invoke(handlers.post, '/api/admin/group-verify/test', { body: { qq: '10000006' }, currentUser: { username: '283405278' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data.inGroup, false);
  assert.equal(res.payload.data.error, 'service_unavailable');
  assert.ok(res.payload.data.errorMessage);
});
