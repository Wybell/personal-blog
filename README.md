# Wybell 个人博客

这是一个使用 Astro 构建的静态个人博客，记录技术项目、学习、工作、生活和随想。

## 本地开发

```bash
pnpm install
pnpm dev
```

生产构建：

```bash
pnpm build
```

构建结果位于 `dist/` 目录。

## 内容位置

- `src/content/blog/`：技术文章
- `src/content/life/`：生活文章
- `src/content/thoughts/`：随想文章
- `public/`：图片、视频和其他静态资源

新增文章后，提交并推送到 GitHub，CI 会自动执行生产构建。

## Docker 部署

博客使用独立的 Nginx Docker 容器运行，默认监听服务器 `8085` 端口，不占用现有项目的 `80` 和 `8084` 端口。Docker 部署文件和 GitHub Actions 配置说明见 [`deploy/SETUP.md`](deploy/SETUP.md)。
