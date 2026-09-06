const http = require("node:http");

const SOCKET_PATH =
  process.env.NAPCAT_BRIDGE_SOCKET || "/run/qqfarm-napcat-bridge.sock";

function requestBridge(method, path, body = null, timeoutMs = 70000) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        path,
        method,
        timeout: timeoutMs,
        headers: payload
          ? {
              "content-type": "application/json",
              "content-length": payload.length,
            }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          let data = null;
          try {
            data = JSON.parse(
              Buffer.concat(chunks).toString("utf8") || "{}",
            );
          } catch {
            return reject(
              new Error(
                `QQ 登录桥接返回非 JSON（HTTP ${res.statusCode}）`,
              ),
            );
          }
          if (res.statusCode < 200 || res.statusCode >= 300 || !data.ok) {
            const error = new Error(
              data.error || `QQ 登录桥接失败（HTTP ${res.statusCode}）`,
            );
            if (res.statusCode === 409 || data.busy) {
              error.busy = true;
              error.retryAfterMs = Number(data.retryAfterMs) || 0;
              error.statusCode = 409;
            }
            return reject(error);
          }
          resolve(data.data || {});
        });
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error("QQ 登录桥接请求超时")),
    );
    req.on("error", (error) =>
      reject(new Error(`QQ 登录桥接不可用: ${error.message}`)),
    );
    if (payload) req.write(payload);
    req.end();
  });
}

function withOwner(path, owner) {
  const value = String(owner || "").trim();
  if (!value) return path;
  return `${path}?owner=${encodeURIComponent(value)}`;
}

module.exports = {
  getNapCatQrCode: (owner = "") =>
    requestBridge("GET", withOwner("/qrcode", owner), null, 70000),

  refreshNapCatQrCode: (owner = "") =>
    requestBridge("POST", withOwner("/refresh", owner), {}, 70000),

  getNapCatLoginStatus: (owner = "") =>
    requestBridge("GET", withOwner("/status", owner), null, 10000),

  getNapCatQrImage: (owner = "") =>
    requestBridge("GET", withOwner("/image", owner), null, 10000),

  authorizeNapCatFarm: (uin = "", owner = "") =>
    requestBridge("POST", "/authorize", { uin, owner }, 90000),

  releaseNapCatScanLease: (owner = "") =>
    requestBridge("POST", "/release", { owner }, 5000),

  reclaimNapCatScanLease: (owner = "") =>
    requestBridge("POST", "/reclaim", { owner }, 8000),

  checkNapCatBridge: () =>
    requestBridge("GET", "/health", null, 5000),
};
