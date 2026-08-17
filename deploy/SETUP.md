# Docker 部署准备

博客使用一个独立的 `nginx:1.27-alpine` 容器运行，默认绑定服务器 `8090` 端口：

```text
http://服务器IP:8090/
```

容器使用 Compose 项目名 `wybell-blog`，部署目录建议使用当前 SSH 用户有权限写入的目录，例如：

```text
/home/你的用户名/wybell-blog
```

它不会使用现有项目的 `80` 或 `8084` 端口，也不会执行 `docker compose down` 或删除其他 Compose 项目。

## GitHub Actions 配置

在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中添加变量：

| 类型 | 名称 | 值 |
| --- | --- | --- |
| Variable | `PUBLIC_SITE_URL` | `http://服务器IP:8090` |
| Variable | `BLOG_PORT` | `8090` |
| Variable | `DEPLOY_SSH_PORT` | `22`，如果 SSH 使用其他端口再修改 |

添加 Secrets：

| 名称 | 说明 |
| --- | --- |
| `DEPLOY_HOST` | 服务器 IP |
| `DEPLOY_USER` | SSH 用户名 |
| `DEPLOY_PATH` | 例如 `/home/你的用户名/wybell-blog` |
| `DEPLOY_SSH_PRIVATE_KEY` | 用于登录服务器的 SSH 私钥全文 |
| `DEPLOY_KNOWN_HOSTS` | 服务器 SSH 主机指纹，不要在工作流中使用自动信任 |

私钥和主机指纹只放在 GitHub Actions Secrets，不要提交到仓库。

## 服务器一次性检查

在服务器上确认 Docker、Compose 和 `rsync` 可用，并确认 `8090` 没有被其他程序占用：

```bash
docker --version
docker compose version
rsync --version
ss -lntp | grep ':8090' || true
```

GitHub Actions 使用 `rsync` 增量同步 `dist/`，首次部署会上传完整站点，后续部署只上传新增或变化的文件。请先在服务器安装 `rsync`；Ubuntu/Debian 可以执行：

```bash
sudo apt-get update
sudo apt-get install -y rsync
```

同步只作用于 `DEPLOY_PATH/dist` 和博客自己的 Compose 配置，博客使用 `wybell-blog` Compose 项目单独重启，不会执行其他项目的 `docker compose down`。

完成 Secrets 和服务器检查后，在 GitHub 的 `Actions -> CD -> Run workflow` 手动执行第一次部署。第一次部署验证成功后，再把 CD 改为 `main` 推送后自动触发。
