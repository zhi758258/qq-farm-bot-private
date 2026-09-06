const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  verifyGroupMembership,
  memberListIncludes,
  normalizeVerifyMode,
} = require('../src/controllers/admin-auth-routes');

function createNapcatServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        handler(req, res, body);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function makeConfig(port, extra = {}) {
  return {
    verifyMode: 'napcat',
    verifyUrl: `http://127.0.0.1:${port}`,
    qqGroupNumber: '695130479',
    verifyToken: '',
    timeoutMs: 3000,
    ...extra,
  };
}

test('normalizeVerifyMode 只认 napcat', () => {
  assert.equal(normalizeVerifyMode('napcat'), 'napcat');
  assert.equal(normalizeVerifyMode('NapCat'), 'napcat');
  assert.equal(normalizeVerifyMode(''), '');
  assert.equal(normalizeVerifyMode('generic'), '');
});

test('memberListIncludes 匹配数字/字符串 user_id 与 uin 兜底', () => {
  const members = [
    { user_id: 10001 },
    { user_id: 283405278 },
    { user_id: '30001' },
  ];
  assert.equal(memberListIncludes(members, '283405278'), true);
  assert.equal(memberListIncludes(members, 283405278), true);
  assert.equal(memberListIncludes(members, '30001'), true);
  assert.equal(memberListIncludes([{ uin: 123 }], '123'), true);
  assert.equal(memberListIncludes(members, '99999'), false);
  assert.equal(memberListIncludes('not-array', '10001'), false);
  assert.equal(memberListIncludes(members, 'abc'), false);
});

test('NapCat 模式：按路径式 action 查单成员并在群内', async () => {
  const { server, port } = await createNapcatServer((req, res, body) => {
    assert.equal(req.method, 'POST');
    assert.ok(req.url.endsWith('/get_group_member_info'), `端点应为 /get_group_member_info，实际 ${req.url}`);
    const parsed = JSON.parse(body);
    assert.deepEqual(parsed, { group_id: 695130479, user_id: 283405278 });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      retcode: 0,
      data: { group_id: 695130479, user_id: 283405278, nickname: '落幕' },
      message: '',
    }));
  });
  try {
    const result = await verifyGroupMembership('283405278', makeConfig(port));
    assert.equal(result.inGroup, true);
    assert.equal(result.error, '');
    assert.equal(result.httpStatus, 200);
  }
  finally {
    await closeServer(server);
  }
});

test('NapCat 模式：Uin2Uid 不存在错误按 not_in_group 处理', async () => {
  const { server, port } = await createNapcatServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'failed',
      retcode: 200,
      data: null,
      message: 'Uin2Uid Error: 用户ID 999999999 不存在',
    }));
  });
  try {
    const result = await verifyGroupMembership('999999999', makeConfig(port));
    assert.equal(result.inGroup, false);
    assert.equal(result.error, 'not_in_group');
    assert.match(result.errorMessage, /NapCat 返回错误/);
  }
  finally {
    await closeServer(server);
  }
});

test('NapCat 模式：非成员语义的其它报错视为服务异常', async () => {
  const { server, port } = await createNapcatServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'failed', retcode: 500, data: null, message: 'Internal boom' }));
  });
  try {
    const result = await verifyGroupMembership('283405278', makeConfig(port));
    assert.equal(result.inGroup, false);
    assert.equal(result.error, 'service_unavailable');
  }
  finally {
    await closeServer(server);
  }
});

test('NapCat 模式：HTTP 500 返回 service_unavailable', async () => {
  const { server, port } = await createNapcatServer((req, res) => {
    res.writeHead(500);
    res.end('boom');
  });
  try {
    const result = await verifyGroupMembership('283405278', makeConfig(port));
    assert.equal(result.inGroup, false);
    assert.equal(result.error, 'service_unavailable');
    assert.equal(result.httpStatus, 500);
  }
  finally {
    await closeServer(server);
  }
});

test('NapCat 模式：非 JSON 响应返回 invalid_response', async () => {
  const { server, port } = await createNapcatServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('NapCat4 Is Running');
  });
  try {
    const result = await verifyGroupMembership('283405278', makeConfig(port));
    assert.equal(result.inGroup, false);
    assert.equal(result.error, 'invalid_response');
  }
  finally {
    await closeServer(server);
  }
});

test('空验证模式回退通用 GET 校验', async () => {
  const { server, port } = await createNapcatServer((req, res) => {
    assert.equal(req.method, 'GET');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data: { inGroup: true } }));
  });
  try {
    const result = await verifyGroupMembership('283405278', makeConfig(port, { verifyMode: '' }));
    assert.equal(result.inGroup, true);
  }
  finally {
    await closeServer(server);
  }
});
