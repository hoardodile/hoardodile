# Hoardodile

Hoardodile 是一个现代数字囤积工具，旨在囤积和预览任意形式的数字内容。它把图片、文档、视频、网页等资源统一收藏在同一个私有内容库中，方便随时浏览与预览。

[English →](./README.md)

## 功能

- **囤积任意内容** — 通过可扩展内容插件支持各种格式与媒体类型。
- **就地预览** — 直接在内容库中浏览和预览资源。
- **自托管且隐私优先** — 数据保留在自有存储中，始终由你掌控。

## 快速开始

```bash
pnpm install
cp .env.example .env   # Windows: copy .env.example .env
pnpm build
pnpm start # http://127.0.0.1:3000
```

需要 Node.js 24 与 pnpm。

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
