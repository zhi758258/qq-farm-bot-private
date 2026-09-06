/**
 * 公告管理路由
 * - GET  /api/announcement          公开读取公告（登录页无需登录）
 * - POST /api/announcement/read     已读公告（需登录 token，普通用户也可）
 * - GET  /api/admin/announcement    管理员读取公告设置
 * - PUT  /api/admin/announcement    管理员保存公告
 */
function registerAdminAnnouncementRoutes({
  app,
  store,
  logger,
  requireAdminToken,
  requireAdminRole,
}) {
  app.get("/api/announcement", (req, res) => {
    try {
      res.json({ ok: true, data: store.getAnnouncement() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/announcement/read", requireAdminToken, (req, res) => {
    try {
      const username = req.currentUser && req.currentUser.username;
      if (!username) {
        return res.status(401).json({ ok: false, error: "未登录" });
      }
      store.markAnnouncementRead(username);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/admin/announcement", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      res.json({ ok: true, data: store.getAnnouncement() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.put("/api/admin/announcement", requireAdminToken, requireAdminRole, (req, res) => {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const content = String(body.content || "");
      const showOnce = body.showOnce !== false;
      const enabled = body.enabled !== false;
      const saved = store.setAnnouncement(content, showOnce, enabled);
      if (logger && typeof logger.warn === "function") {
        logger.warn("更新公告", {
          admin: req.currentUser && req.currentUser.username,
          enabled: saved.enabled,
          showOnce: saved.showOnce,
          contentLength: saved.content.length,
        });
      }
      res.json({ ok: true, data: saved });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerAdminAnnouncementRoutes };
