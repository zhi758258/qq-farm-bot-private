const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const multer = require("multer");
const { getDataFile } = require("../config/runtime-paths");
const { normalizeQq } = require("../models/user-store");
const { verifyGroupMembership } = require("./admin-auth-routes");

const LOGIN_ASSETS_DIR = getDataFile("login-assets");
const LOGIN_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGIN_LOGO_EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/svg+xml", ".svg"],
  ["image/x-icon", ".ico"],
  ["image/vnd.microsoft.icon", ".ico"],
]);

fs.mkdirSync(LOGIN_ASSETS_DIR, { recursive: true });

const loginLogoUpload = multer({
  storage: multer.diskStorage({
    destination: LOGIN_ASSETS_DIR,
    filename(req, file, callback) {
      callback(null, `${crypto.randomUUID()}${LOGIN_LOGO_EXTENSIONS.get(file.mimetype)}`);
    },
  }),
  limits: { fileSize: LOGIN_LOGO_MAX_BYTES, files: 1 },
  fileFilter(req, file, callback) {
    if (!LOGIN_LOGO_EXTENSIONS.has(file.mimetype)) {
      return callback(new Error("仅支持 PNG、JPG、WebP、GIF、SVG 或 ICO 图片"));
    }
    return callback(null, true);
  },
}).single("file");

function deleteManagedLoginLogo(logoUrl) {
  const prefix = "/login-assets/";
  const value = String(logoUrl || "");
  if (!value.startsWith(prefix)) return;
  const filename = path.basename(value.slice(prefix.length));
  if (!filename) return;
  try {
    fs.unlinkSync(path.join(LOGIN_ASSETS_DIR, filename));
  } catch {}
}

function registerAdminSystemRoutes({
  app,
  store,
  logger,
  requireAdminToken,
  requireAdminRole,
  requireDangerConfirmation,
  getDefaultSystemConfig,
  getRuntimeConfig,
  updateRuntimeConfig,
}) {
  const isAllowedPublicLink = (value) => {
    const link = String(value || "").trim();
    return (
      !link ||
      link.startsWith("/") ||
      /^https?:\/\//i.test(link) ||
      /^mqqapi:\/\//i.test(link)
    );
  };

  const isAllowedImageLink = (value) => {
    const link = String(value || "").trim();
    return !link || link.startsWith("/") || /^https?:\/\//i.test(link);
  };

  app.get(
   "/api/admin/system-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        res.json({
          ok: true,
          data: {
            saved: store.getSystemConfig(),
            default: getDefaultSystemConfig(),
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.get("/api/public/login-links", (req, res) => {
    try {
      res.json({ ok: true, data: store.getLoginLinks() });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  const cleanLoginLinkText = (value) => String(value ?? "").trim().slice(0, 200);

  app.get(
    "/api/admin/login-links",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        res.json({ ok: true, data: store.getLoginLinks() });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/login-links",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const { logoUrl, title, loginSubtitle, registerSubtitle, purchaseUrl, qqGroupUrl } = req.body || {};
        const checkImage = (value) => {
          const link = String(value ?? "").trim();
          return !link || isAllowedImageLink(link);
        };
        const checkPublic = (value) => {
          const link = String(value ?? "").trim();
          return !link || isAllowedPublicLink(link);
        };
        if (!checkImage(logoUrl)) {
          return res.status(400).json({ ok: false, error: "登录图标地址仅支持 http(s) 或站内路径" });
        }
        if (!checkPublic(purchaseUrl)) {
          return res.status(400).json({ ok: false, error: "购买/开通地址仅支持 http(s)、mqqapi 或站内路径" });
        }
        if (!checkPublic(qqGroupUrl)) {
          return res.status(400).json({ ok: false, error: "加QQ群链接仅支持 http(s)、mqqapi 或站内路径" });
        }
        const saved = store.setLoginLinks({
          logoUrl,
          title: cleanLoginLinkText(title),
          loginSubtitle: cleanLoginLinkText(loginSubtitle),
          registerSubtitle: cleanLoginLinkText(registerSubtitle),
          purchaseUrl,
          qqGroupUrl,
        });
        logger.warn("更新登录页设置", {
          admin: req.currentUser?.username || "",
          title: saved?.title || "",
          hasLogo: !!saved?.logoUrl,
          hasPurchaseUrl: !!saved?.purchaseUrl,
          hasQqGroupUrl: !!saved?.qqGroupUrl,
        });
        res.json({ ok: true, data: saved });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/login-links/reset",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const current = store.getLoginLinks();
        deleteManagedLoginLogo(current.logoUrl);
        const saved = store.setLoginLinks({
          logoUrl: "",
          title: "",
          loginSubtitle: "",
          registerSubtitle: "",
          purchaseUrl: "",
          qqGroupUrl: "",
        });
        logger.warn("重置登录页设置为默认值", {
          admin: req.currentUser?.username || "",
        });
        res.json({ ok: true, data: saved });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/login-logo",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      loginLogoUpload(req, res, (uploadError) => {
        try {
          if (uploadError) {
            const message = uploadError.code === "LIMIT_FILE_SIZE"
              ? "图片大小不能超过 2MB"
              : String(uploadError.message || "图片上传失败");
            return res.status(400).json({ ok: false, error: message });
          }
          if (!req.file) {
            return res.status(400).json({ ok: false, error: "未收到图片文件" });
          }
          const current = store.getLoginLinks();
          const newLogoUrl = `/login-assets/${req.file.filename}`;
          const saved = store.setLoginLinks({ ...current, logoUrl: newLogoUrl });
          deleteManagedLoginLogo(current.logoUrl);
          logger.warn("上传登录图标", {
            admin: req.currentUser?.username || "",
            logoUrl: newLogoUrl,
          });
          res.json({ ok: true, data: saved });
        } catch (error) {
          res.status(500).json({ ok: false, error: error.message });
        }
      });
    },
  );

  app.get(
    "/api/admin/group-verify",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        res.json({ ok: true, data: store.getGroupVerifyConfig() });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/group-verify",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        const { enabled, qqGroupNumber, verifyUrl, verifyToken, verifyMode, timeoutMs } = req.body || {};
        if (enabled === true) {
          const url = String(verifyUrl || "").trim();
          if (!url) {
            return res.status(400).json({ ok: false, error: "启用群验证时必须填写验证接口地址" });
          }
          if (!/^https?:\/\//i.test(url)) {
            return res.status(400).json({ ok: false, error: "验证接口地址必须以 http:// 或 https:// 开头" });
          }
          if (!String(qqGroupNumber || "").trim()) {
            return res.status(400).json({ ok: false, error: "启用群验证时必须填写QQ群号" });
          }
        }
        const saved = store.setGroupVerifyConfig({
          enabled,
          qqGroupNumber,
          verifyUrl,
          verifyToken,
          verifyMode,
          timeoutMs,
        });
        logger.warn("更新QQ群验证配置", {
          admin: req.currentUser?.username || "",
          enabled: saved?.enabled === true,
          qqGroupNumber: saved?.qqGroupNumber || "",
          verifyUrl: saved?.verifyUrl || "",
          verifyMode: saved?.verifyMode || "",
        });
        res.json({ ok: true, data: saved });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/group-verify/test",
    requireAdminToken,
    requireAdminRole,
    async (req, res) => {
      try {
        const { qq } = req.body || {};
        const qqCheck = normalizeQq(qq);
        if (!qqCheck.ok) {
          return res.status(400).json({ ok: false, error: qqCheck.error });
        }
        const config = store.getGroupVerifyConfig();
        if (!String(config.verifyUrl || "").trim()) {
          return res
            .status(400)
            .json({ ok: false, error: "请先填写并保存群机器人验证接口地址" });
        }
        const result = await verifyGroupMembership(qqCheck.data, config);
        logger.warn("测试QQ群验证接口", {
          admin: req.currentUser?.username || "",
          qq: qqCheck.data,
          qqGroupNumber: config.qqGroupNumber || "",
          verifyUrl: config.verifyUrl || "",
          inGroup: result.inGroup === true,
          error: result.error || "",
          durationMs: result.durationMs || 0,
        });
        res.json({
          ok: true,
          data: {
            qq: qqCheck.data,
            qqGroupNumber: config.qqGroupNumber || "",
            ...result,
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
   "/api/admin/system-config",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "UPDATE_SYSTEM_CONFIG")) return;
        const { serverUrl, clientVersion, platform, os } = req.body || {};
        const saved = store.setSystemConfig({
          serverUrl,
          clientVersion,
          platform,
          os,
        });
        updateRuntimeConfig(saved);
        logger.warn("更新系统配置", {
          admin: req.currentUser?.username || "",
          serverUrl: saved?.serverUrl || "",
          clientVersion: saved?.clientVersion || "",
          platform: saved?.platform || "",
          os: saved?.os || "",
          confirmation: "UPDATE_SYSTEM_CONFIG",
        });
        res.json({
          ok: true,
          data: {
            saved,
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

  app.post(
    "/api/admin/system-config/reset",
    requireAdminToken,
    requireAdminRole,
    (req, res) => {
      try {
        if (!requireDangerConfirmation(req, res, "RESET_SYSTEM_CONFIG")) return;
        const saved = getDefaultSystemConfig();
        store.setSystemConfig(saved);
        updateRuntimeConfig(saved);
        logger.warn("重置系统配置", {
          admin: req.currentUser?.username || "",
          confirmation: "RESET_SYSTEM_CONFIG",
        });
        res.json({
          ok: true,
          data: {
            saved,
            current: getRuntimeConfig(),
          },
        });
      } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
      }
    },
  );

}

module.exports = { registerAdminSystemRoutes };
