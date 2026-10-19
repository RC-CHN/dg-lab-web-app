# Kubernetes / K3s 部署

`deploy/kubernetes` 提供 Kustomize 基础清单：单副本 Deployment、ClusterIP Service、配置与命名空间。镜像固定到已验证的提交，管理员口令通过独立 Secret 注入。ConfigMap 的 `ADMIN_SESSION_HOURS` 默认 168（7 天）。

## 准备与部署

在仓库外建立部署目录，把 `deploy/kubernetes` 复制为其中的 `base/`。下面的 `kustomization.yaml` 放在部署目录根部；把示例域名、镜像代理与标签替换为自己的实际值。

```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - base
images:
  - name: ghcr.io/rc-chn/dg-lab-web-app
    newName: harbor.example.com/ghcr/rc-chn/dg-lab-web-app
    newTag: v1.9.1
patches:
  - target:
      kind: ConfigMap
      name: dg-lab-web-app
    patch: |-
      - op: replace
        path: /data/APP_ORIGIN
        value: https://panel.example.com
```

不使用 Harbor 时删除 `images` 段，直接使用 GHCR。代理项目需事先配置为 GHCR；拉取地址遵循 `<Harbor>/<代理项目>/<原镜像仓库>:<标签>`，见 [Harbor 文档](https://goharbor.io/docs/2.14.0/administration/configure-proxy-cache/)。私有代理项目还需在本命名空间创建拉取 Secret，并配置 `imagePullSecrets`。

```bash
umask 077
kubectl apply -f base/namespace.yaml
# 只在首次安装时生成，不要在升级时覆盖现有口令。
test -f admin-password || python3 -c 'import secrets; print(secrets.token_urlsafe(32), end="")' > admin-password
kubectl -n dg-lab-web-app create secret generic dg-lab-web-app-admin \
  --from-file=ADMIN_PASSWORD=admin-password
kubectl apply --dry-run=server -k .
kubectl apply -k .
kubectl -n dg-lab-web-app rollout status deployment/dg-lab-web-app --timeout=300s
```

K3s 若默认配置无读取权限，但已配置用户 kubeconfig，先设置 `export KUBECONFIG="$HOME/.kube/config"`。

入口可使用现有 Ingress 转发到 Service 的 80 端口；`/api/events` 要允许长连接并关闭代理缓冲。证书在入口终止，`APP_ORIGIN` 设置为浏览器实际访问的 HTTPS 地址。

使用 MetalLB 局域网独立 IP 时，在 overlay 中把 Service 的 `/spec/type` 改为 `LoadBalancer`。可先创建 Service，读取 `.status.loadBalancer.ingress[0].ip`，再把 `APP_ORIGIN` 设置为 `http://该IP` 并部署应用。服务端口 80，容器端口 8787。管理员入口为 `/admin`；口令留在服务器权限为 600 的 `admin-password` 文件中，不提交 Git。

## 验证与升级

```bash
kubectl -n dg-lab-web-app get pods,svc
kubectl -n dg-lab-web-app logs deployment/dg-lab-web-app --tail=30
curl --fail https://panel.example.com/healthz
```

健康响应包含 `ok: true` 和当前 `version`。再通过 `/admin` 验证管理员认证，控制台可用隔离演示测试播放与停止，无需登录官方账号或连接设备。

升级时修改 overlay 的镜像标签或 digest，再执行 dry-run、apply 和 rollout status。回滚用 `kubectl -n dg-lab-web-app rollout undo deployment/dg-lab-web-app`，并将 overlay 改回原镜像，避免下次 apply 再覆盖。

会话、官方登录和正在运行的任务保存在进程内存中，因此保持一个副本，使用 [Recreate 更新策略](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#recreate-deployment)。重启或升级后需要重新登录、加入房间并开始播放；挂载 PVC 不会改变这一点。普通网页切页或锁屏不会重启服务。
