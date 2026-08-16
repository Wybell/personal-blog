---
title: "从 GitHub Actions 到手动 CD：给一个项目建立可验证的发布链路"
description: "记录 EventFlow 如何把前端、后端检查和生产发布拆成自动 CI 与手动 CD，并用提交 SHA、SSH 主机校验和健康检查降低误发布风险。"
pubDate: 2026-08-16
updatedDate: 2026-08-16
section: practice
projectSlug: eventflow
cover: /cover-practice-ci-cd.png
coverAlt: "GitHub Actions 手动 CD 发布链路封面"
tags:
  - GitHub Actions
  - Docker Compose
  - CI/CD
  - SSH
  - Nginx
  - 发布验证
featured: false
---

“把代码推到 GitHub，然后登录服务器执行几条命令”也可以完成一次发布，但它很难回答三个问题：这次发布是否经过检查，服务器拉到的代码是不是刚刚检查过的版本，容器启动后服务是否真的可用。EventFlow 的交付实践没有追求复杂的平台化发布，而是把最容易出错的步骤固化成 GitHub Actions 和服务器脚本：代码提交后自动 CI，生产发布由我确认后手动触发。

这篇文章只记录当前项目已经实现的交付链路，不把它包装成零停机发布、自动回滚或完整的云原生平台。

## 一、为什么把 CI 和 CD 分开

EventFlow 的发布边界是：

```text
push / pull request 到 main
              |
              v
        GitHub Actions CI
        前端检查 + 后端 verify
              |
              v
     人工确认需要发布的 main
              |
              v
 GitHub Actions Deploy Production
 workflow_dispatch + confirm=true
              |
              v
 SSH 到腾讯云 CVM -> 更新代码 -> Docker Compose
              |
              v
 /actuator/health 返回 200
```

CI 自动运行是为了尽早发现问题；CD 保留手动确认，是因为这套项目的服务器和生产数据仍然是个人项目级环境，不希望任何一次 push 都直接触发生产构建。分开以后，开发频率和生产发布频率可以不同。

## 二、CI 工作流检查什么

`.github/workflows/ci.yml` 在 push、Pull Request 和手动触发时运行，并发组会取消同一分支上已经失去意义的旧检查。

### 前端 job

前端使用 pnpm、Node.js 22 和锁文件安装依赖，依次执行：

```yaml
- run: pnpm install --frozen-lockfile
- run: pnpm --dir frontend lint
- run: pnpm --dir frontend typecheck
- run: pnpm --dir frontend test --run --pool=forks
- run: pnpm --dir frontend build
```

这五步分别覆盖依赖可复现、代码规范、TypeScript 类型、Vitest 测试和生产构建。`--frozen-lockfile` 很重要，它禁止 CI 根据当前 package.json 临时改写锁文件，避免本地和 CI 安装出不同依赖树。

### 后端 job

后端使用 Java 17 和 Maven Wrapper：

```yaml
- uses: actions/setup-java@v5
  with:
    distribution: temurin
    java-version: "17"
    cache: maven
- run: chmod +x mvnw && ./mvnw -B verify
```

`verify` 会经过项目配置的格式检查、Checkstyle、编译和测试阶段。后端 Maven 项目使用 Spring Boot 3.4.4、MyBatis-Plus、Flyway、JJWT，以及 Testcontainers 测试依赖。

CI 的作用是“证明这次提交通过了预先定义的检查”，并不等于证明所有生产环境行为都被覆盖。当前项目仍然没有完整浏览器 E2E 和真实生产流量压测，这些边界需要在发布说明中保持透明。

## 三、手动发布为什么必须绑定同一个 SHA

手动 CD 工作流首先 checkout `main`，解析本次发布的 commit SHA，然后通过 GitHub Checks API 确认这个 SHA 对应的 `Frontend checks` 和 `Backend checks` 都已经完成且结论为成功：

```bash
checks="$(gh api \
  "/repos/${GITHUB_REPOSITORY}/commits/${RELEASE_SHA}/check-runs?filter=latest" \
  --jq '[.check_runs[] | select(.name == "Frontend checks" or .name == "Backend checks") | {name, status, conclusion}]')"

echo "$checks" | jq -e \
  'length == 2 and all(.[]; .status == "completed" and .conclusion == "success")'
```

这一步比“我刚刚看过 Actions 是绿的”更可靠，因为它把发布对象和检查对象绑定到了同一个提交。服务器脚本还会再次执行：

```bash
git fetch origin main
REMOTE_SHA="$(git rev-parse origin/main)"
if [[ "$REMOTE_SHA" != "$EXPECTED_SHA" ]]; then
  exit 1
fi
```

如果在 CI 检查完成之后，GitHub 的 `main` 又被新的提交推进，服务器不会把旧 SHA 当成最新代码发布，脚本会拒绝继续。

## 四、SSH Secret 如何做到够用且可验证

部署工作流使用 GitHub Environment `production` 中的 secrets，包含服务器地址、端口、用户、私钥和 known hosts。私钥以 Base64 形式保存，运行时解码到临时 SSH 目录，并设置 `600` 权限。

```bash
printf '%s' "$SSH_PRIVATE_KEY_B64" \
  | base64 --decode > "$HOME/.ssh/id_ed25519"
printf '%s\n' "$SSH_KNOWN_HOSTS" \
  | tr -d '\r' > "$HOME/.ssh/known_hosts"
chmod 600 "$HOME/.ssh/id_ed25519" "$HOME/.ssh/known_hosts"
ssh-keygen -y -f "$HOME/.ssh/id_ed25519" >/dev/null
```

`StrictHostKeyChecking=yes` 配合 `known_hosts` 的作用，是避免部署过程中因为“方便连接”而关闭主机身份校验。工作流只把部署脚本上传到服务器临时目录，再通过 SSH 传入已经解析好的 SHA 和发布范围，不把密码或 `.env` 文件写进仓库。

## 五、服务器脚本实际做了哪些保护

服务器路径固定为 `/opt/eventflow`，脚本 `scripts/deploy-production.sh` 会先验证：

- SHA 必须是 40 位小写 Git commit SHA。
- 发布范围必须是 `frontend`、`backend` 或 `all`。
- `/opt/eventflow` 必须是 Git checkout，并且当前分支必须是 `main`。
- 工作区不能有未提交改动。
- `deploy/.env` 和 Compose 文件必须存在。
- Docker Compose v2 可用。

确认通过后，服务器使用 `git merge --ff-only` 更新到目标提交，再执行：

```bash
cd /opt/eventflow/deploy
docker compose --env-file .env -f docker-compose.yml config --quiet
```

`config --quiet` 先验证 Compose 配置和环境变量是否完整。后端或全量发布前会执行 `backup.sh`；随后根据发布范围构建并启动前端、后端或全部服务。

## 六、Docker Compose 与 Nginx 的职责

生产 Compose 当前包含 MySQL 8.4、Redis 7.4、RabbitMQ 4.1、Spring Boot 后端和 Nginx 静态前端容器。MySQL、Redis、RabbitMQ 都配置了健康检查，后端依赖它们健康后再启动。

Nginx 监听服务器的 8084 端口，把请求反向代理到本机的前端容器端口；前端容器再通过 Nginx 配置把 `/api` 请求转给后端。实际公网域名尚未配置时，项目使用 IP + 端口访问，所以 Nginx 配置暂时采用 IP 场景的 `server_name _`。

这里的 Compose 解决的是个人项目的服务编排和重启，不代表已经实现 Kubernetes、多节点扩容、蓝绿发布或滚动发布。

## 七、最后的健康检查不是可有可无

容器显示 `Up` 只能说明进程没有立刻退出，不等于 HTTP 服务已经完成启动、数据库迁移已经结束、请求链路可用。脚本会读取 `.env` 中的 HTTP 端口，在最多 30 次循环中请求：

```bash
curl -sS -o /dev/null -w '%{http_code}' \
  --max-time 5 \
  "http://127.0.0.1:${HTTP_PORT}/actuator/health"
```

只有返回 HTTP 200 才输出部署成功；否则 trap 会打印 Compose 状态以及后端、前端最近 200 行日志。这样失败发布至少有可定位信息，而不是只留下一句“SSH 命令执行失败”。

## 八、当前方案的边界和下一步

这条链路已经覆盖了我最需要的几层可靠性：自动检查、同 SHA 校验、主机身份校验、服务器干净工作区、Compose 配置校验、备份和健康检查。它仍然有明确边界：

- 发布是手动触发，不是自动审批流。
- 没有自动回滚到上一版本。
- 没有蓝绿或滚动发布，服务重建期间可能有短暂影响。
- 健康检查当前是单一 HTTP 200 检查，不是完整业务验收。
- 没有把生产 secrets 复制到 GitHub 仓库。

对个人项目来说，先把发布过程变成可重复、可审计、可失败诊断的脚本，价值高于堆叠更多平台名词。后续真正需要提高稳定性时，再考虑镜像仓库、版本制品、自动回滚和更完整的 smoke test。
