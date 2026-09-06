function hasElevatedRole(user) {
  return user && (user.role === "admin" || user.role === "super_admin");
}

function requireAdmin(req, res) {
  const currentUser = req.currentUser;
  if (!currentUser) {
    res.status(401).json({ ok: false, error: "未登录" });
    return null;
  }
  if (!hasElevatedRole(currentUser)) {
    res.status(403).json({ ok: false, error: "需要管理员权限" });
    return null;
  }
  return currentUser;
}

/**
 * 用户/卡密管理与卡密领取接口
 *
 * 管理接口（/api/admin/*）需要 requireAdminToken + requireAdminRole，
 * 公共接口（/api/card-claim/*）允许未登录访问。
 */
function registerAdminUserManageRoutes({
  app,
  logger: _logger,
  userStore,
  requireAdminToken,
  requireAdminRole,
  getAdminUserMutationError,
}) {
  /* ================= 卡密管理 ================= */

  app.get("/api/admin/cards", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      const cards = userStore.getAllCards();
      return res.json({ ok: true, data: cards });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/admin/cards", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      const { type, days, description, count } = req.body || {};
      const batchCount = Number(count) > 1 ? Number(count) : 1;
      if (Number(days) <= 0) {
        return res
          .status(400)
          .json({ ok: false, error: "卡密天数必须大于 0" });
      }
      if (batchCount > 1) {
        const cards = userStore.createCardsBatch(batchCount, {
          type: type || "time",
          days: Number(days),
          description: description || "",
        });
        return res.status(201).json({ ok: true, data: { count: cards.length, cards } });
      }
      const result = userStore.createCard({
        type: type || "time",
        days: Number(days),
        description: description || "",
      });
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      return res.status(201).json({ ok: true, data: result.data });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post(
    "/api/admin/cards/batch-delete",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const { codes } = req.body || {};
        if (!Array.isArray(codes) || codes.length === 0) {
          return res
            .status(400)
            .json({ ok: false, error: "请选择要删除的卡密" });
        }
        const result = userStore.deleteCardsBatch(codes);
        if (!result.ok) {
          return res.status(400).json({ ok: false, error: result.error });
        }
        return res.json({ ok: true, data: { deleted: result.deleted } });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/cards/:code",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const code = String((req.params && req.params.code) || "").trim();
        const { type, days, description, enabled, status } = req.body || {};
        const update = {};
        if (typeof type === "string" && type.trim()) update.type = type.trim();
        if (typeof days === "number" && days > 0) update.days = days;
        if (typeof description === "string") update.description = description;
        if (typeof enabled === "boolean") update.enabled = enabled;
        if (typeof status === "string" && status) update.status = status;
        const result = userStore.updateCard(code, update);
        if (!result.ok) {
          return res.status(400).json({ ok: false, error: result.error });
        }
        return res.json({ ok: true, data: result.data });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.delete(
    "/api/admin/cards/:code",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const code = String((req.params && req.params.code) || "").trim();
        const result = userStore.deleteCard(code);
        if (!result.ok) {
          return res.status(400).json({ ok: false, error: result.error });
        }
        return res.json({ ok: true });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  /* ================= 用户管理 ================= */

  app.get("/api/admin/users", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      const users = userStore.getAllUsers();
      return res.json({ ok: true, data: users });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/admin/users/stats", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      const stats = userStore.getUserStats();
      return res.json({ ok: true, data: stats });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post(
    "/api/admin/users/cleanup-expired",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const currentUser = requireAdmin(req, res);
        if (!currentUser) return;
        const { dryRun } = req.body || {};
        const result = userStore.cleanupExpiredUsers({
          excludeUsernames: [currentUser.username],
          dryRun: dryRun === true,
        });
        return res.json({ ok: true, data: result });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  function getTargetUsername(req) {
    return String((req.params && req.params.username) || "").trim();
  }

  function getMutationBlock(currentUser, targetUsername) {
    if (!targetUsername) {
      return { blocked: true, error: "用户不存在" };
    }
    if (currentUser && currentUser.username === targetUsername) {
      return { blocked: true, error: "不能对当前登录账号执行此操作" };
    }
    if (typeof getAdminUserMutationError === "function") {
      const error = getAdminUserMutationError(currentUser, targetUsername);
      if (error) return { blocked: true, error };
    }
    return { blocked: false };
  }

  app.post(
    "/api/admin/users/:username/edit",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const currentUser = requireAdmin(req, res);
        if (!currentUser) return;
        const target = getTargetUsername(req);
        const block = getMutationBlock(currentUser, target);
        if (block.blocked) {
          return res.status(400).json({ ok: false, error: block.error });
        }
        const {
          role,
          accountLimit,
          note,
          qq,
          cardEnabled,
          expiresAt,
          newUsername,
          password,
          isPermanent,
        } = req.body || {};
        const update = {};
        if (typeof newUsername === 'string' && newUsername.trim()) {
          update.newUsername = newUsername.trim();
        }
        if (typeof password === 'string' && password) update.password = password;
        if (typeof role === 'string' && role.trim()) update.role = role.trim();
        if (typeof accountLimit === 'number') update.accountLimit = accountLimit;
        if (typeof note === 'string') update.note = note;
        if (typeof qq === 'string') update.qq = qq;
        if (typeof isPermanent === 'boolean') update.isPermanent = isPermanent;
        if (expiresAt !== undefined) {
          if (expiresAt === null) {
            update.expiresAt = null;
          }
          else if (typeof expiresAt === 'number') {
            update.expiresAt = expiresAt;
          }
          else if (typeof expiresAt === 'string' && expiresAt.trim()) {
            update.expiresAt = expiresAt;
          }
        }
        const cardUpdate = {};
        if (typeof cardEnabled === 'boolean') cardUpdate.enabled = cardEnabled;
        const result = userStore.editUser({
          username: target,
          update,
          cardUpdate: Object.keys(cardUpdate).length > 0 ? cardUpdate : null,
        });
        if (!result.ok) {
          return res.status(400).json({ ok: false, error: result.error });
        }
        return res.json({ ok: true, data: result.data });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/users/:username",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const currentUser = requireAdmin(req, res);
        if (!currentUser) return;
        const target = getTargetUsername(req);
        const block = getMutationBlock(currentUser, target);
        if (block.blocked) {
          return res.status(400).json({ ok: false, error: block.error });
        }
        const { role, accountLimit, note } = req.body || {};
        const update = {};
        if (typeof role === "string" && role.trim()) update.role = role.trim();
        if (typeof accountLimit === "number") update.accountLimit = accountLimit;
        if (typeof note === "string") update.note = note;
        const result = userStore.editUser({
          username: target,
          update,
          cardUpdate: null,
        });
        if (!result.ok) {
          return res.status(400).json({ ok: false, error: result.error });
        }
        return res.json({ ok: true, data: result.data });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.delete(
    "/api/admin/users/:username",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const currentUser = requireAdmin(req, res);
        if (!currentUser) return;
        const target = getTargetUsername(req);
        const block = getMutationBlock(currentUser, target);
        if (block.blocked) {
          return res.status(400).json({ ok: false, error: block.error });
        }
        const result = userStore.deleteUser(target);
        if (!result.ok) {
          return res.status(400).json({ ok: false, error: result.error });
        }
        return res.json({ ok: true });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/users/:username/renew",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const currentUser = requireAdmin(req, res);
        if (!currentUser) return;
        const target = getTargetUsername(req);
        const block = getMutationBlock(currentUser, target);
        if (block.blocked) {
          return res.status(400).json({ ok: false, error: block.error });
        }
        const { cardCode } = req.body || {};
        if (!cardCode) {
          return res.status(400).json({ ok: false, error: "卡密不能为空" });
        }
        const result = userStore.renewUser({
          username: target,
          cardCode,
        });
        if (!result.ok) {
          return res.status(400).json({ ok: false, error: result.error });
        }
        return res.json({ ok: true, data: result.data });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  /* ================= 卡密领取（管理员配置） ================= */

  app.get(
    "/api/admin/card-claim/status",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      const status = userStore.getCardClaimStatus();
      return res.json({ ok: true, data: status });
    },
  );

  app.post(
    "/api/admin/card-claim/status",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const { enabled, type, cardCode } = req.body || {};
        const current = userStore.getCardClaimStatus() || {};
        const next = {
          enabled: typeof enabled === "boolean" ? enabled : !!current.enabled,
          type: type || current.type || "card",
          cardCode:
            typeof cardCode === "string" ? cardCode : current.cardCode || "",
        };
        userStore.setCardClaimStatus(next);
        return res.json({ ok: true, data: next });
      } catch (error) {
        return res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.get(
    "/api/admin/card-claim/records",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      const records = userStore.getCardClaimRecords();
      return res.json({ ok: true, data: records });
    },
  );

  /* ================= 卡密领取（公开） ================= */

  app.get("/api/card-claim/status", (req, res) => {
    const status = userStore.getCardClaimStatus();
    return res.json({ ok: true, data: status });
  });

  app.post("/api/card-claim/claim", (req, res) => {
    try {
      const ua =
        String((req.headers && req.headers["user-agent"]) || "").trim()
        || String(userStore.getClientIp(req) || "").trim()
        || "anonymous";
      const existing = (userStore.getCardClaimRecords() || []).find(
        (r) => r && String(r.ua || "") === String(ua || ""),
      );
      if (existing) {
        return res
          .status(400)
          .json({ ok: false, error: "每个设备只能领取一次卡密" });
      }
      const result = userStore.claimCardByUA(ua);
      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      return res.status(201).json({ ok: true, data: result.data });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerAdminUserManageRoutes };
