# @hoardodile/sdk-types

The plugin manifest contract and shared message/danmaku/anchor shapes —
the single source of truth for wire types consumed by every SDK package,
the host, and the app. Nothing here touches the DOM or node.

## Install

```bash
pnpm add @hoardodile/sdk-types
```

## What's in it

The root entry is **zod-free** — plugin bundles that import it never
pull zod. Runtime validators live behind the
`@hoardodile/sdk-types/schema` subpath, used only by the host, the
server, and tooling.

- **`PluginSchema`** — the per-plugin schema interface: declare `file`,
  `sourceMeta`, `searchMeta`, `anchor` once and both `definePlugin`
  (`@hoardodile/sdk-server`) and the web API (`@hoardodile/sdk-web` /
  `@hoardodile/sdk-react`) are typed from it
- **Plugin definition** — `PluginDefinition`/`ResourceAPI`/`definePlugin`/
  fixtures/`HOOK_NAMES`, re-exported by `@hoardodile/sdk-server`
- **Wire shapes** — `Message`, `Danmaku`, `ResAnchor`, `AnchorData`,
  `DanmakuMode`, `DanmakuListFilter`, `FileStats`, `SearchMeta`,
  `SerializedFileList`, `ReadFileRange`
- **Template vocabulary** — the corner-template and anchor-chip
  directives the host's template engine renders
- **`@hoardodile/sdk-types/schema`** — the zod layer: `pluginManifest`
  (validated everywhere via its parse: server install, build CLI,
  workbench), `pluginManifestId`, `anchorData`
- **Constants** (subpath-only, no root export):
  - `@hoardodile/sdk-types/media-exts` — canonical media extension
    sets: `IMAGE_EXTS`, `VIDEO_EXTS`, `AUDIO_EXTS`, extension ↔ MIME /
    media-kind lookups
  - `@hoardodile/sdk-types/plugin` — plugin runtime limits: read cap
    (`PLUGIN_READ_FILE_MAX_BYTES`), probe/stat fan-out bounds, animation
    scan batch
  - `@hoardodile/sdk-types/resource` — resource caps: `SEARCH_META_VERSION`,
    preview eligibility caps
  - `@hoardodile/sdk-types/image-variant` — derived-image variant
    contract: spec types, query parsing/encoding, canonical cache
    identity
  - `@hoardodile/sdk-types/template` — the host cover/message template
    grammar (tokeniser, parser — shared with the web renderer and the
    CLI's build-time lint)
  - `@hoardodile/sdk-types/text-limits` — plugin input limits:
    `MAX_DANMAKU_TEXT_LENGTH`, `MAX_COMMENT_BODY_LENGTH`

## When to import it

Usually only for types (`PluginSchema`, `PluginManifest`).
`@hoardodile/sdk-server` re-exports the plugin definition and the
message/danmaku shapes; `@hoardodile/sdk-web` re-exports the wire types
its consumers need — you rarely import this package directly in plugin
code. Reach for `/schema` only when you need a runtime validator (app
code, tooling).
