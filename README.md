# DG-LAB Web App · PULSE DECK

自托管 COYOTE 2.0 远程控制面板。手机与电脑共用一套界面，支持暗黑街机、复古音响和暖色主题。

[![CI](https://github.com/RC-CHN/dg-lab-web-app/actions/workflows/ci.yml/badge.svg)](https://github.com/RC-CHN/dg-lab-web-app/actions/workflows/ci.yml)

## 功能

- 独立管理员认证，官方账号登录、加入远程房间、接管设备。
- 粘贴或选择二维码图片识别房间邀请；控制台一键进入邀请协作。
- A/B 强度、设备回传上限、暂停与归零、自由触控、节奏格、按住开火。
- 24 个内置波形、队列与循环、定时启停、固定／随机间隔。
- 常驻波形小窗、实时发送示波器、按需展开的设备反馈。
- 双轨录制、绘图、回声、DJ、音乐联动、随机波形、分支场景和受限协作邀请。
- 多人协作支持主控加 7 位玩家，A/B 幅值分路累加、独立上限、实时贡献显示和逐人撤销。
- 已准备的循环任务由服务器执行，网页切页、锁屏或关闭后继续。

实际控制需要房主手机运行官方 App 并通过蓝牙连接 2.0 主机。本项目不是蓝牙网关；完整功能差异见 [原版对照](docs/PARITY.txt)。

## 本地运行

需要 Node.js 24+。

```bash
git clone https://github.com/RC-CHN/dg-lab-web-app.git
cd dg-lab-web-app
npm ci
cp .env.example .env
# 编辑 .env：设置至少 12 位的 ADMIN_PASSWORD
npm run build
npm start
```

访问 `http://localhost:8787`。`/admin` 管理真实连接；不设置管理员口令时仍可使用隔离演示。

管理员登录默认有效 7 天，可通过 `ADMIN_SESSION_HOURS` 设置（1–720 小时）。重启会清除会话。版本变更见 [更新记录](CHANGELOG.md)。

加密运行时和波形数据已随仓库提供，不需要另行解包 APK。开发模式运行 `npm run dev`。

## Docker 与 HTTPS

```bash
cp .env.example .env
# 设置 ADMIN_PASSWORD；公网使用实际 HTTPS 地址作为 APP_ORIGIN
docker compose up -d --build
```

已有反向代理可转发到 `127.0.0.1:8787`，并关闭 `/api/events` 的代理缓冲。

使用内置 Caddy：把域名指向服务器，在 `.env` 设置 `PANEL_DOMAIN` 和 `APP_ORIGIN=https://你的域名`，开放 80/443，然后运行：

```bash
docker compose --profile https up -d --build
```

镜像部署、自动发布、可选 SSH 部署及回滚见 [CI/CD](docs/CI-CD.md)。

集群部署使用 [Kubernetes / K3s 清单与说明](docs/KUBERNETES.md)，支持 Harbor 代理镜像。

## 开发与验证

```bash
npm ci
npx playwright install --with-deps chromium
npm test
npm run build
npm run test:ui
docker build -t dglab-panel:local .
npm run test:container
npm run check:public
```

浏览器测试自动启动并清理离线模拟服务器，不访问官方账号或真实设备。若浏览器已经安装，可通过 `CHROMIUM_PATH` 指定可执行文件。端口 8787、8791 需空闲。

## 项目结构

```text
src/              React 界面、主题、实验室玩法
server/           HTTP / SSE、官方房间协议、权限和后台播放器
shared/           波形、触控算法、回传字段及内置数据
vendor/           请求加解密运行时与第三方许可
tests/            单元、协议、浏览器与容器测试
scripts/          测试编排、公开内容检查、部署与打包
docs/             使用、API、CI/CD 与原版差异
.github/workflows/ 持续集成、镜像发布、可选部署
```

部署不依赖任何其他工作目录。

## 文档与许可

[使用说明](docs/USAGE.txt) · [API](docs/API.txt) · [CI/CD](docs/CI-CD.md) · [原版对照](docs/PARITY.txt) · [敏感信息处理](SECURITY.md)

本项目编写的代码采用 [GPL-3.0-only](LICENSE)。仓库同时包含原 APK 的运行时和波形数据；这些第三方文件没有已确认的独立再分发许可，不纳入本项目的 GPL 授权。来源与范围见 [第三方说明](THIRD_PARTY_NOTICES.txt)。
