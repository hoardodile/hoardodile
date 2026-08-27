# Hoardodile

Hoardodile 是一个现代数字囤积工具，旨在囤积和预览任意形式的数字内容。它把图片、文档、视频、网页等资源统一收藏在同一个私有内容库中，方便随时浏览与预览。

[English →](./README.md)

## 功能

- **囤积任意内容** — 通过可扩展内容插件支持各种格式与媒体类型。
- **就地预览** — 直接在内容库中浏览和预览资源。
- **插件市场** — 通过“设置 → 插件市场”发现并安装内容插件（内置默认注册单：`hoardodile/marketplace`）。
- **桌面应用** — Windows / Linux / macOS 安装包自带自动更新；也可运行自托管网页版或 Docker 镜像。
- **自托管且隐私优先** — 数据保留在自有存储中，始终由你掌控。

## 快速开始

```bash
pnpm install
cp .env.example .env   # Windows: copy .env.example .env
pnpm build
pnpm start # http://127.0.0.1:3000
```

需要 Node.js 24 与 pnpm。

## Docker 部署

```bash
docker compose up -d   # http://localhost:3000
```

- 数据保存在命名卷 `hoardodile-data`（挂载于 `/data`）；`docker compose down -v` 会**删除数据**——如需直接查看目录，可用 bind mount `./data:/data`。镜像以非 root 用户运行，自带 HEALTHCHECK（`docker compose ps` 可查看状态）。
- 升级 = 重新构建/拉取镜像后 `docker compose up -d`，迁移在下次启动时自动执行。内置的 gallery/pdf 插件是种子插件：卸载不会删除打包原件，且对该库保持卸载状态，直到你在 **设置 → 插件市场 → 捆绑插件** 中离线还原（新镜像不会自动重新下发）。
- 若放在 TLS 反向代理之后，请设置 `FORCE_HTTPS=true` 并从 `environment` 中移除 `SESSION_SECURE_COOKIE=false`；完整环境变量见 `.env.example`。自定义插件：将插件目录挂载到 `/app/plugins/<slug>`（不要覆盖内置种子插件），然后在界面中安装；若要分发自己的插件，用 GitHub Release 发布并把“设置 → 插件市场”指向你的注册单仓库（内置默认为 `hoardodile/marketplace`）——见 `packages/cli/README.md`。

## AI 技能

可用 `npx` 直接从 GitHub 下载本仓库的 agent 技能（open agent skills 生态的 `skills` CLI）：

```bash
npx skills add hoardodile/hoardodile@hd-plugin         # 编写内容插件
npx skills add hoardodile/hoardodile@hd-plugin-design  # 插件界面设计系统（基于 @hoardodile/ui）
npx skills add hoardodile/hoardodile --list             # 列出仓库内全部技能
```

- `hd-plugin` — 编写 hoardodile 内容插件：manifest、服务端钩子、iframe 客户端、工具链。
- `hd-plugin-design` — 基于 `@hoardodile/ui` 的插件界面设计系统。

## 贡献

当前暂不接受 Pull Request;欢迎提交 bug 报告与功能想法 — 详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

[GPL-3.0](LICENSE)
