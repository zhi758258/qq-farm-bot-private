<div align="center">

<img src="web/public/icon.png" width="96" alt="QQ Farm Bot 图标">

# QQ Farm Bot

🌱 一位会自己浇水、除草、收菜的 QQ 农场小帮手

[能做什么](#-能做什么) · [微信扫码](#-微信扫码登录) · [开始种田](#-开始种田) · [Docker 部署](#-docker-部署) · [更新记录](docs/CHANGELOG.md) · [使用文档](#-使用文档) · [支持项目](#-支持项目)

</div>

> [!WARNING]
> 快乐种田，谨慎使用。本项目仅供学习和研究，自动化操作可能违反游戏服务条款，账号及其他相关风险由使用者自行承担。

## 🌾 能做什么

- 👨‍🌾 **照看多座农场**：多个账号统一管理，也可以单独控制
- 💧 **打理日常农活**：农场、好友、任务、商城和活动自动化
- 🖥️ **随时看看田里**：Web 控制面板、实时日志和数据统计
- 🌻 **认识每株作物**：作物图鉴、土地状态和变异效果展示
- 🎉 **赶上限时活动**：活动功能持续更新，还有活动分析
- 📱 **轻松添加账号**：支持内置微信扫码、手机抓包登录和 QQ 好友同步
- 📦 **多种方式开工**：支持源码、Docker 和桌面二进制构建

> 🌱 想看看这片农场是怎么一步步长大的吗？前往[农场成长记录](docs/CHANGELOG.md)查看最新更新和完整历史。

## <th><img src="https://cdn.simpleicons.org/wechat/07C160" height="20" alt="微信" /></th> 微信扫码登录

微信玩家可直接在“添加账号 → 微信扫码”中完成登录。扫码链路已内置到 Bot 进程，通过应用宝 OAuth 获取微信会话，并使用内置 MMTLS 协议换取农场短时效 Code，无需额外部署 YYB-GO、第三方登录 API 或代理容器。

## 🧺 小推车里装了什么

| 模块 | 技术 |
| --- | --- |
| 后端 | Node.js、Express、Socket.IO、CommonJS |
| 前端 | Vue 3、Vite、TypeScript、Pinia、UnoCSS |
| 工程 | pnpm workspace、Docker |

管理面板默认住在 `3007` 端口。

## 🚜 开始种田

### 准备工具

- Node.js 20+
- pnpm 10+
- Git

### 把农场跑起来

```bash
git clone https://github.com/xxxscarlxrd404/qq-farm-bot.git
cd qq-farm-bot

corepack enable
pnpm install
pnpm build:web
pnpm dev:core
```

看到服务启动后，打开 <http://localhost:3007>，你的农场控制室就准备好了。

首次登录使用以下默认凭据：

```text
用户名：admin
密码：admin
```

> [!IMPORTANT]
> 第一次进门记得马上换掉默认密码，也不要把管理面板直接暴露到公网。

想继续装修控制室？可以另外启动前端开发服务器：

```bash
pnpm dev:web
```

## 🐳 Docker 部署

```bash
git clone https://github.com/xxxscarlxrd404/qq-farm-bot.git
cd qq-farm-bot
docker compose up -d --build
```

查看运行状态和日志：

```bash
docker compose ps
docker compose logs -f
```

更新代码后重新构建：

```bash
git pull
docker compose up -d --build
```

默认映射：

| 用途 | 端口或目录 |
| --- | --- |
| Web 管理面板 | `3007` |
| 抓包代理端口 | `18000` |
| 持久化数据 | 仓库上级目录的 `data/` |

源码运行、Docker 和二进制发布版的抓包服务均默认关闭；只有在
“系统配置 → Code/GID 抓取服务”中开启后才会启动，并且只使用代理端口 `18000`。

如需指定抓包服务对外地址，可在仓库根目录创建 `.env`：

```dotenv
CAPTURE_ADVERTISE_IPS=192.168.1.100,100.64.0.2
```

## 🔑 登录方式

项目支持微信扫码、手动填码和手机抓包三种账号添加方式。

### 微信扫码

1. 进入“添加账号 → 微信扫码”。
2. 页面会自动生成二维码；也可以点击二维码空态或“获取/刷新二维码”。
3. 使用手机微信扫码，并在应用宝授权页确认。
4. 授权成功后账号会自动添加、开启 Code 刷新并启动。

微信扫码会话与当前面板用户绑定。若凭证已被微信撤销、长时间停机后过期或手机重新授权导致旧会话失效，需要重新扫码。

账号建立 WebSocket 连接后，Bot 会读取登录回包和心跳回包中的 `version_force` 或 `version_recommend`。检测到符合格式的完整版本（例如 `1.13.1.6_20260723`）时，会自动更新“系统配置 → 客户端版本”，后续连接直接使用该值。强制版本优先于推荐版本，日期部分来自服务端原始版本，不会按本机当天日期生成。

### 手机抓包

iPhone及安卓用户也可使用内置抓包登录服务自动获取登录 Code，并同步 QQ 平台好友。

抓包基本流程：

1. 在“系统配置 → Code/GID 抓取服务”中开启抓包登录。
2. 进入“添加账号 → 抓包登录”，点击“开始抓取”。
3. 按页面提示安装并信任 CA 证书，设置手机 Wi-Fi 代理。
4. 完全关闭并重新打开 QQ 农场，等待面板获取 Code。
5. 完成后关闭手机 Wi-Fi 代理。

证书安装、局域网和 Tailscale 配置请查看[抓包登录服务手册](core/docs/capture-service.md)。

## 🛠️ 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm dev:core` | 启动后端和已构建的管理面板 |
| `pnpm dev:web` | 启动前端开发服务器 |
| `pnpm build:web` | 构建前端 |
| `pnpm lint` | 检查前后端代码 |
| `pnpm -C core test` | 运行后端测试 |
| `pnpm package:release` | 构建各平台二进制文件 |

二进制构建产物位于 `core/dist/`。首次运行时，程序会在数据目录中生成账号、日志和缓存等文件。

## 🗺️ 农场地图

```text
qq-farm-bot/
├── core/                 # 后端、自动化引擎及协议实现
│   ├── docs/             # 登录、活动与 TSDK 维护文档
│   ├── src/              # 配置、接口、模型和业务服务
│   └── test/             # 后端测试
├── web/                  # Vue 管理面板
├── docs/images/          # README 图片资源
├── docker-compose.yml
└── package.json
```

## 📖 使用文档

- [iPhone 抓包登录服务](core/docs/capture-service.md)
- [限时活动适配手册](core/docs/activity-update-runbook.md)
- [TSDK/WASM 更新手册](core/docs/tsdk-update-runbook.md)
- [TSDK/ACE 运行机制](core/docs/tsdk-ace-runtime.md)

## 🔒 数据与安全

`core/data/` 及 Docker 持久化目录可能包含账号、用户、登录日志、好友缓存和统计数据。请妥善备份，并避免提交到公开仓库。

以下内容不应提交：

- 运行时数据与账号信息
- `.env` 及其他密钥文件
- 日志、缓存和临时文件
- `node_modules/` 与构建产物

## 📌 免责声明
本项目仅供学习与研究用途。使用本工具可能违反游戏服务条款，由此产生的一切后果由使用者自行承担。

**盈利声明**
-  本项目为开源学习项目，任何形式的付费倒卖、源码售卖、付费代部署、收费授权、付费二开等行为均与作者无关。
- 作者自身以及从未授权任何第三方以任何形式向他人收费或牟利。若你通过付费渠道获取本项目，请知悉该费用与作者无关。
- 因倒卖、二次转售造成的损失、账号风险或纠纷，均与作者无关，请自行联系售卖者。

**风险说明**：
- 部署、使用本项目产生的任何封号、数据丢失、法律或其他后果，均由使用者自行承担，作者不作任何担保。
