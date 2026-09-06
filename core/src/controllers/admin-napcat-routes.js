const {
  getNapCatQrCode,
  refreshNapCatQrCode,
  getNapCatLoginStatus,
  getNapCatQrImage,
  authorizeNapCatFarm,
  releaseNapCatScanLease,
  reclaimNapCatScanLease,
  checkNapCatBridge,
} = require("../services/napcat-bridge-client");

const NAPCAT_FARM_APP_ID = "1112386029";

const FARM_CODE_TASK_TTL_MS = 10 * 60 * 1000;
const farmCodeTasks = new Map();

function pruneFarmCodeTasks() {
  const now = Date.now();
  for (const [id, task] of farmCodeTasks) {
    if (now - task.createdAt > FARM_CODE_TASK_TTL_MS) {
      farmCodeTasks.delete(id);
    }
  }
}

function createFarmCodeTask(owner) {
  pruneFarmCodeTasks();
  const taskId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  farmCodeTasks.set(taskId, {
    status: "running",
    result: null,
    error: "",
    busy: false,
    retryAfterMs: 0,
    owner: String(owner || ""),
    createdAt: Date.now(),
  });
  return taskId;
}

function scanOwner(req) {
  const token = String(req.adminToken || "").trim();
  return token ? `token:${token.slice(0, 12)}` : "";
}

function sendBridgeError(res, error) {
  if (error && error.busy) {
    res.status(409).json({
      ok: false,
      error: error.message,
      busy: true,
      retryAfterMs: error.retryAfterMs || 0,
    });
    return;
  }
  res.status(502).json({ ok: false, error: error.message });
}

function registerAdminNapCatRoutes({ app, provider, store }) {
  app.get("/api/qr/napcat-login", async (req, res) => {
    try {
      const data = await getNapCatQrCode(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      sendBridgeError(res, error);
    }
  });

  app.post("/api/qr/napcat-refresh", async (req, res) => {
    try {
      const data = await refreshNapCatQrCode(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      sendBridgeError(res, error);
    }
  });

  app.get("/api/qr/napcat-poll", async (req, res) => {
    try {
      const data = await getNapCatLoginStatus(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      sendBridgeError(res, error);
    }
  });

  app.get("/api/qr/napcat-image", async (req, res) => {
    try {
      const data = await getNapCatQrImage(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      sendBridgeError(res, error);
    }
  });

  app.get("/api/qr/napcat-status", async (_req, res) => {
    try {
      await checkNapCatBridge();
      res.json({
        ok: true,
        data: { bridge: "reachable", appId: NAPCAT_FARM_APP_ID },
      });
    } catch (error) {
      res.status(503).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/qr/napcat-release", async (req, res) => {
    try {
      const data = await releaseNapCatScanLease(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      res.json({ ok: true, data: { released: false, reason: error.message } });
    }
  });

  app.post("/api/qr/napcat-reclaim", async (req, res) => {
    try {
      const data = await reclaimNapCatScanLease(scanOwner(req));
      res.json({ ok: true, data });
    } catch (error) {
      sendBridgeError(res, error);
    }
  });

  app.post("/api/qr/napcat-farm-code", async (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const accountId = String(body.accountId || body.id || "").trim();
      const allAccounts = provider.getAccounts
        ? provider.getAccounts().accounts || []
        : [];
      const existing = accountId
        ? allAccounts.find((account) => String(account.id) === accountId)
        : null;

      if (accountId && !existing) {
        return res.status(404).json({ ok: false, error: "账号不存在" });
      }
      if (
        existing &&
        String(existing.platform || "qq").toLowerCase() !== "qq"
      ) {
        return res
          .status(400)
          .json({ ok: false, error: "QQ 授权不能覆盖微信账号" });
      }

      const owner = scanOwner(req);
      const taskId = createFarmCodeTask(owner);

      void performFarmCodeAuth({ body, owner, accountId, existing })
        .then((result) => {
          farmCodeTasks.set(taskId, {
            status: "done",
            result,
            error: "",
            busy: false,
            retryAfterMs: 0,
            owner,
            createdAt: Date.now(),
          });
        })
        .catch((error) => {
          farmCodeTasks.set(taskId, {
            status: "error",
            result: null,
            busy: !!error.busy,
            retryAfterMs: Number(error.retryAfterMs) || 0,
            error:
              error && error.message ? error.message : String(error),
            owner,
            createdAt: Date.now(),
          });
        });

      return res.json({ ok: true, pending: true, taskId });
    } catch (error) {
      sendBridgeError(res, error);
    }
  });

  app.get("/api/qr/napcat-farm-code/status", (req, res) => {
    const taskId = String(req.query.taskId || "").trim();
    const task = taskId ? farmCodeTasks.get(taskId) : null;
    if (!task) {
      return res
        .status(404)
        .json({ ok: false, error: "授权任务不存在或已过期" });
    }
    if (task.owner && task.owner !== scanOwner(req)) {
      return res.status(403).json({ ok: false, error: "无权查询该授权任务" });
    }
    return res.json({
      ok: true,
      status: task.status,
      result: task.result,
      error: task.error,
      busy: !!task.busy,
      retryAfterMs: task.retryAfterMs || 0,
    });
  });

  async function performFarmCodeAuth({ body, owner, accountId, existing }) {
    const data = await authorizeNapCatFarm(
      existing && (existing.uin || existing.qq) || "",
      owner,
    );
    const authorization = data.authorization || {};
    const profile = data.profile || {};

    if (!authorization.code) {
      throw new Error("QQ 授权未返回农场 Code");
    }

    const boundOpenId = String(
      existing && (existing.openID || existing.openid) || "",
    ).trim();
    if (
      existing &&
      boundOpenId &&
      authorization.openID &&
      authorization.openID !== boundOpenId
    ) {
      throw new Error("当前 QQ 与目标农场账号不匹配");
    }

    const payload = {
      ...(existing || {}),
      ...(existing ? { id: accountId } : {}),
      name: existing
        ? String(body.name ?? existing.name ?? "").trim()
        : String(body.name || "").trim(),
      code: authorization.code,
      openID: authorization.openID || boundOpenId,
      openid: authorization.openID || boundOpenId,
      uin: profile.uin || existing?.uin || "",
      qq: profile.uin || existing?.qq || "",
      avatar: profile.avatar || existing?.avatar || "",
      platform: "qq",
      loginType: "napcat_open_auth",
    };

    const wasRunning = provider.isAccountRunning
      ? provider.isAccountRunning(accountId)
      : false;

    const saved = store.addOrUpdateAccount(payload);
    const updated = existing
      ? saved.accounts.find((account) => String(account.id) === accountId)
      : saved.accounts.at(-1);

    if (!updated) {
      throw new Error("保存 QQ 农场账号失败");
    }

    if (typeof provider.scheduleAutoCodeRefresh === "function") {
      try {
        provider.scheduleAutoCodeRefresh(updated.id);
      } catch (err) {
        if (provider.addAccountLog) {
          provider.addAccountLog(
            "auto_refresh_schedule_failed",
            `自动刷新 Code 定时器注册失败: ${err && err.message ? err.message : String(err)}`,
            updated.id,
            updated.name || "",
          );
        }
      }
    }

    let startAction = "none";
    if (wasRunning && provider.restartAccount) {
      provider.restartAccount(updated.id, { skipLoginRefresh: true });
      startAction = "restart";
    } else if (provider.startAccount) {
      provider.startAccount(updated.id, { skipLoginRefresh: true });
      startAction = "start";
    }

    if (provider.addAccountLog) {
      const startNote =
        startAction === "restart"
          ? "，已重启账号"
          : startAction === "start"
            ? "，已自动启动账号"
            : "";
      provider.addAccountLog(
        existing ? "update" : "add",
        `通过 QQ 扫码${existing ? "更新" : "添加"}农场授权${startNote}`,
        updated.id,
        updated.name || "",
      );
    }

    return {
      success: true,
      account: {
        id: updated.id,
        name: updated.name,
        platform: "qq",
        loginType: "napcat_open_auth",
      },
      authorization: {
        appId: NAPCAT_FARM_APP_ID,
        source: "NapCat OpenAuth",
        expiresAt: authorization.expiresAt || null,
      },
    };
  }
}

module.exports = { registerAdminNapCatRoutes };
