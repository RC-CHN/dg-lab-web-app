# CI/CD 与部署

## 自动运行的流水线

`.github/workflows/ci.yml` 在 `main` 推送、`v*` 标签、PR 和手动触发时运行。

1. 检查所有跟踪文件是否夹带本地状态；Gitleaks 扫描完整 Git 历史，输出脱敏。
2. Node.js 24 安装锁定依赖，执行单元/协议测试并构建前端。
3. Playwright Chromium 验证桌面、手机、三主题、协作、示波器与后台播放。
4. 构建生产容器，在只读文件系统中验证认证、播放、停止与退出。
5. 从 Git HEAD 打包源码与 SHA-256 校验文件，保存在 Actions artifacts 中。
6. 仅在以上检查通过后，`main`/版本标签发布 amd64 和 arm64 镜像到 GHCR；PR 不发布。

镜像：`ghcr.io/rc-chn/dg-lab-web-app`。

Kubernetes / K3s 使用 [集群部署说明](KUBERNETES.md) 和 `deploy/kubernetes`；下面的 SSH Deploy 工作流用于 Docker Compose 服务。

| 标签 | 用途 |
| --- | --- |
| `latest` | 最近通过检查的 main，方便体验 |
| `sha-完整40位提交SHA` | 可追溯部署与回滚 |
| `v1.8.0` 等 | 对应发布标签 |

Actions 只用内建 `GITHUB_TOKEN` 发布镜像，无需保存个人访问令牌。所有引用的 Actions 固定到提交 SHA，Dependabot 提供升级 PR。配置依据：[GitHub 镜像发布文档](https://docs.github.com/en/actions/tutorials/publish-packages/publish-docker-images)。

新 GHCR 包的可见性需要在 **Packages → dg-lab-web-app → Package settings** 核实。若仍为 Private，可改为 Public；私有包的服务器必须事先用有 `read:packages` 权限的凭据登录 GHCR。公开仓库不自动证明包也公开。[GitHub 容器仓库文档](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

## 第一次部署

服务器需要 Docker Engine、Compose v2（支持 `up --wait`）和 Bash。

```bash
git clone https://github.com/RC-CHN/dg-lab-web-app.git
cd dg-lab-web-app
cp .env.example .env
chmod 600 .env
# 编辑 ADMIN_PASSWORD、APP_ORIGIN、PANEL_DOMAIN
# 建议同时设置 PANEL_IMAGE=ghcr.io/rc-chn/dg-lab-web-app:sha-具体提交SHA
docker compose -p dg-lab-web-app -f compose.production.yaml pull
docker compose -p dg-lab-web-app -f compose.production.yaml up -d --wait
```

HTTPS 在上述两条命令中增加 `--profile https`；80/443 需开放。已有反代则只运行 panel，保持默认监听 `127.0.0.1:8787`。Nginx 对 `/api/events` 禁用 `proxy_buffering`。

直接从源码构建用默认 `compose.yaml`：`docker compose up -d --build`。镜像仓库暂不可用时，这条路径仍然可用。

## 可选的 SSH 部署工作流

`Deploy` 默认不会自动触发。创建 GitHub Environment **production**，按需要设置审批人、只允许 main，然后配置环境 Secrets：

| Secret | 内容 |
| --- | --- |
| `DEPLOY_HOST` | 服务器主机名或 IPv4 |
| `DEPLOY_USER` | 已有 Docker 权限的专用部署用户 |
| `DEPLOY_PATH` | 首次部署目录的绝对路径，只使用字母、数字、下划线、横线和斜杠 |
| `DEPLOY_SSH_KEY` | 该部署用户专用 SSH 私钥 |
| `DEPLOY_KNOWN_HOSTS` | 已通过可信渠道核实的服务器 SSH 主机公钥记录 |

首次部署须先成功。此工作流升级已有服务，不初始化服务器，也不上传或更改管理员口令。`.env` 始终留在服务器；官方账号凭据不进入 Actions。

在 Actions → Deploy → Run workflow，选择 **main**，输入已发布的 `sha-...` 或 `v...` 标签。工作流校验参数、严格验证 SSH 主机密钥，服务器使用 `flock` 防止并行部署，再拉取镜像并等待健康检查。健康检查失败会尝试恢复原镜像；只有成功时才把新 `PANEL_IMAGE` 写入服务器 `.env`。

未配置服务器 Secrets 时不应运行 Deploy。配置完成后的首次远程部署需要在自己的服务器上验证，CI 不代替该验证。

## 手动升级与回滚

```bash
# 在已有部署目录执行；替换为确认发布成功的真实 SHA 标签
bash scripts/deploy.sh ghcr.io/rc-chn/dg-lab-web-app:sha-完整提交SHA "$PWD"
```

回滚同样运行该命令，传入之前的 SHA 标签。升级会重启进程，官方登录、房间连接和正在运行的任务会结束；重新登录并连接后由操作者重新开始。

## 版本发布

更新 `package.json` 与 `package-lock.json` 的版本，提交并等待 main CI 成功后：

```bash
git tag v1.8.0
git push origin v1.8.0
```

标签触发同样的全部检查，成功后生成版本镜像。`npm run release:archive` 仅打包已提交的 HEAD，不会收集 `.env`、测试截图、日志或任何未跟踪文件。第三方运行时与波形资源按当前仓库版本一并打包，许可说明随包提供。
