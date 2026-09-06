# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-09-05
- Context: Discovered by Agent while 修复 QQ 群验证（NapCat 直连）
- Category: Operations & Deployment
- Instructions:
  - 群验证支持两种验证方式（`core/data/store.json` → `groupVerify.verifyMode`）：`''`/空为通用 GET 校验接口（旧约定，`GET ?qq=&group=`，NapCat 不适用），`'napcat'` 为 bot 直连 NapCat/OneBot11 正向 HTTP（配置 NapCat HTTP 地址 + QQ群号 + NapCat access_token）。
  - NapCat 的关键约束（2026-09-05 实测）：HTTP action 走 **URL 路径式**（如 `POST http://ip:3000/get_group_member_info`，body 直接放 params `{"group_id":..., "user_id":...}`）；根路径式（body `{action, params}`）NapCat 不识别，GET 根路径只回 `NapCat4 Is Running`。HTTP 服务开启鉴权后不带 access_token 所有 action 返回 `token verify failed!`。成员查询返回 `retcode:0 + data`，非成员返回 `Uin2Uid Error: 用户ID xxx 不存在`（应判 not_in_group，其余 NapCat 报错判 service_unavailable）。
  - 改动文件：`core/src/controllers/admin-auth-routes.js`（verifyGenericMembership/verifyNapcatMembership，NapCat 用 get_group_member_info 单查，避免 get_group_member_list 只回 50 条截断）、`core/src/models/store.js`（DEFAULT_GROUP_VERIFY_CONFIG 含 verifyMode）、`core/src/controllers/admin-system-routes.js`（透传 verifyMode）、`web/src/components/admin/AdminGroupVerifyCard.vue`（验证方式下拉）、`core/test/group-verify-napcat.test.js`。
  - 管理后台 admin API 鉴权头是 `x-admin-token`（不是 `Authorization: Bearer`）；curl 调 `/api/admin/*` 需带 `-H "x-admin-token: <登录token>"`。
  - 群验证配置保存在 3007 后台「系统配置 → QQ群验证」卡片；改后端 `store.js` 后须重启 `pnpm -C core dev` 才生效（node 不热加载）。

[Project Knowledge Summary]
- Date: 2026-09-05
- Context: Discovered by Agent while 移植用户/卡密/公告/群验证系统并完成账号私有化与账号改名
- Category: Operations & Deployment
- Instructions:
  - 本仓库对应远端为 GitHub 私有仓库 https://github.com/zhi758258/qq-farm-bot-private（2026-09-05 从公开 fork zhi758258/qq-farm-bot 迁移而来，新仓库不是 fork，无法用网页 Sync fork；跟上游 xxxscarlxrd404/qq-farm-bot 需 `git remote add upstream <url>` 后 fetch/merge）。
  - 默认超级管理员账号为 `283405278` / 密码 `hai232658`，且 `mustChangePassword=false`，登录不弹强制改密；数据存于 `core/data/users.json`，代码常量在 `core/src/models/user-store.js` 的 `DEFAULT_ADMIN`。
  - 注册接口禁止使用 `admin`（不区分大小写）作为用户名（`RESERVED_USERNAMES`，在 `registerUserWithCard` 中校验），并禁止使用默认管理员用户名注册（findUser 重名拦截）。
  - 后台侧边栏底部署名显示 `283405278`（`web/src/components/Sidebar.vue`），不再显示上游作者 xxxscarlxrd404。
  - README 中 git clone 地址保留上游公开仓库（可用于获取源码），爱发电原作者支持段已移除。

[Project Knowledge Summary]
- Date: 2026-09-06
- Context: Discovered by Agent while 把 qq-farm-bot 复制进当前工作区并启动预览
- Category: Build Methods
- Instructions:
  - 依赖安装：仓库根目录 `pnpm install`（workspace 含 core + web）。
  - 本环境预览：后端 `ADMIN_PORT=3007 pnpm -C core dev`，前端 `pnpm -C web dev --host 0.0.0.0 --port 5173`；Vite 已代理 `/api`、`/socket.io`、`/game-config` 到 3007。
  - `web/vite.config.ts` 的 `server.allowedHosts` 需含 `.monkeycode-ai.online`，预览走前端 5173。
