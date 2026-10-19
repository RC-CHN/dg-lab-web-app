# 敏感信息与问题报告

请勿在公开 Issue、PR、日志或截图中附上官方账号密码、手机号、会话 Cookie、CSRF、邀请链接、房间连接令牌或服务器 SSH 密钥。

本仓库的 `.env.example` 不包含默认管理员口令。`.env`、私有目录、日志、浏览器测试截图和本地构建产物由 Git 与 Docker 忽略规则排除。测试中的 `Fixture-*`、`MOCK_*`、测试手机号和邀请仅属于离线模拟器，不是真实服务凭据。

官方密码不落盘；账号和房间令牌只保存在服务器内存。管理员认证到期或退出会停止本会话控制。服务器应使用 HTTPS，并将 `APP_ORIGIN` 配置为实际访问源。

发布前执行 `npm run check:public` 和 `gitleaks git --redact`。CI 对全部 Git 历史执行同样的密钥扫描。规则能发现常见泄漏，不能证明任意格式的敏感数据都不存在。

漏洞可通过仓库的 **Security → Report a vulnerability** 私下报告。不要先公开可用的凭据或利用细节。
