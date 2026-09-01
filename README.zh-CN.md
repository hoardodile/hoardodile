# Hoardodile

<p align="center">
  <img src="./docs/images/hoardodile-demo.png" alt="Hoardodile 存储库" width="740" />
</p>

现代数字囤积工具。把图片、文档、视频、音频、PDF 等收进**一个私人存储库**——就地浏览与预览，数据保存在你自己的存储上。

[English →](./README.md)

## 功能

- **囤积任意内容** — 通过可扩展内容插件支持图片、文档、视频、音频、PDF、漫画、小说与归档。
- **就地预览** — 在存储库里直接打开资源：查看器、阅读器、文件树。
- **插件市场** — 从 **设置 → 插件市场** 安装更多内容插件，从漫画、小说阅读到 Live2D、Spine、DragonBones 骨架动画插件。
- **桌面或自托管** — Windows、macOS、Linux 安装包，或自己运行。
- **默认隐私** — 数据留在你的存储上，无遥测。

## 获取

**桌面版** — [下载最新版本](https://github.com/hoardodile/hoardodile/releases)。

## 自托管

需要 **Node 24** 与 **pnpm**。

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm start    # http://127.0.0.1:3000
```

## Docker

```bash
docker compose up -d
```

## AI 技能

```bash
npx skills add hoardodile/hoardodile@hd-plugin
npx skills add hoardodile/hoardodile@hd-plugin-design
```

## 贡献

欢迎通过 [issues](https://github.com/hoardodile/hoardodile/issues) 提交 bug 与想法；当前暂不接受 Pull Request。

## 许可证

[GPL-3.0](LICENSE)
