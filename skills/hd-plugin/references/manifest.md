# Manifest Contract

`manifest.json` is the plugin's identity card: what it claims, what it
may touch, and how its cards/search/messages appear in the host UI.
The app validates it on install (Settings → Plugins) and rescans.

## Fields

```jsonc
{
  "id": "a1b2c3d4-…",            // REQUIRED — random UUID, unique per plugin,
                                 //   never copy a template's id
  "name": "My Plugin",           // REQUIRED — user-facing (i18n overrides it)
  "description": "What it claims.",
  "version": "0.0.0",
  "minAppVersion": "0.1.8",      // optional — lowest hoardodile release this
                                 //   plugin runs on; absent = every version
  "icon": "box",                 // optional — Solar glyph name (three weights,
                                 //   follows the user's icon style preference)
                                 //   or a zip asset path ("assets/icon.svg");
                                 //   Solar-only, no URLs/data: URIs
  "permissions": { … },          // see below
  "i18n": { … },                 // see below
  "ui": { … }                    // see below
}
```

**`id`**: generate with `node -e "console.log(crypto.randomUUID())"`.
**`version`**: the plugin's own version; the app shows it (Settings →
Plugins) — bump it on user-visible changes.
**`minAppVersion`**: the lowest hoardodile release the plugin runs on
(e.g. `"0.1.8"`). Hosts below it refuse to install or update the plugin —
the marketplace hides the install/update entries and the zip upload is
blocked with an explanation — so declare it honestly and bump it only when
the plugin really needs a newer app. Omit it for plugins that support every
release.
**`icon`**: shown on the plugin's card/row in Settings → Plugins and the
install preview. A **Solar glyph name** (any glyph from the host's full
Solar index — see `hd-design` Iconography) or a relative asset
path inside your plugin zip. Names outside the Solar set render the
fallback icon; `http(s):`/`data:` URIs and `..` paths are rejected on
install.

## Permissions

Every flag is a promise; without it the corresponding host capability is
not wired, and the plugin's calls are rejected by the bridge.

| Permission | Grants |
| --- | --- |
| `sourceMeta` | Plugin's `sourceMeta` result is shown (card corners, summaries). |
| `searchMeta` | Plugin's `searchMeta` is indexed and searchable. |
| `danmaku` | Read/create danmaku (bullet comments) for the resource. |
| `message` | Read/create anchored messages for the resource. |
| `imageHashes` | `imageHashes` results participate in duplicate detection. |
| `container` | `listContainer`/`extractArchive` (archive entries) work; the sandbox denies these APIs without it. Use it to read inside archives (`outer!inner`) and to materialize non-zip containers for browser reads. |
| `download` | The plugin asset vault: `download`/`statAsset`/`readAsset`/`deleteAsset` work (both sides of the plugin), *and* every `download()` call needs your approval in the shared dialog — one batched `download([…])` is ONE dialog listing every item (all-or-nothing, ≤16 items). Denied by default. |

The gallery manifest shows the typical media-plugin set:
`{ "sourceMeta": true, "searchMeta": true, "danmaku": true, "message": true, "imageHashes": true }`.
A read-only viewer may ship only `sourceMeta`; the builtin file plugin adds
`"container": true` for archive listing. A plugin that ships a runtime it
cannot bundle (licensing) declares `"download": true` and fetches it on
first use — usually several files in **one batched `download([…])`**, so
the user approves a single dialog that lists every URL; files always land
in the plugin's own `vault/` folder.

## i18n

Every user-visible string the host renders should come from `i18n`, in
the app's five supported languages — `en`, `zh`, `ja`, `de`, `es` (only
`en`/`zh` at minimum; untranslated labels fall back exact locale → base
language → first shipped). Keys you define for your own labels (search
kind labels, etc.) are referenced from the `ui` block:

```jsonc
"i18n": {
  "name": { "en": "PDF", "zh": "PDF", "ja": "PDF", "de": "PDF", "es": "PDF" },
  "description": { "en": "Online PDF reader.", "zh": "PDF 阅读器。", "ja": "オンライン PDF リーダー。", "de": "Online-PDF-Reader.", "es": "Lector de PDF en línea." },
  "pagesLabel": { "en": "pages", "zh": "页", "ja": "ページ", "de": "Seiten", "es": "páginas" }
}
```

## ui

```jsonc
"ui": {
  "height": "85vh",                     // iframe height hint
  "inheritFont": true,                  // default: inherit host font stack;
                                        //   false keeps your own fonts
  "card": {
    "default": {                        // keyed by source kind — the only
      "bl": [ "…templates…" ]           //   keys are "default", "image",
    }                                   //   "video", "audio"; each corner
  },                                    //   slot (tl/tr/bl/br) is optional
  "search": {
    "kinds": [
      { "key": "kind", "label": "{{t('labelKey')}}", "icon": "{{icon('Box')}}" }
    ]
  },
  "message": { "anchor": "{{duration(data.timeMs)}}" }
}
```

- **`card.<kind>`** — one entry per kind your `sourceMeta` can produce;
  `default` covers the rest. Corner slots (`tl`/`tr`/`bl`/`br`) are all
  optional and take template expressions that resolve to small strings
  (counts, durations, versions…).
- **`search.kinds`** — searchable categories your plugin supplies.
  `key` is stable and typed; labels via `{{t()}}`; icons via
  `{{icon('<SolarGlyph>')}}` (see `hd-design` for the icon set).
  Every kind must appear in the plugin's `searchMeta` hook output — the
  facets are boolean flags computed once at import/upload time (not per
  search), and `v` in that payload bumps whenever the plugin changes its
  facet algorithm incompatibly (stale rows are then rebuilt).
- **`message.anchor`** — how an anchored message renders in the host
  (e.g. `{{duration(data.timeMs)}}` for a video timestamp). Applies only
  with the `message` permission.

### Template expressions

`{{t('key')}}` — i18n label · `{{icon('<SolarGlyph>')}}` — **Solar glyph
name only** (full set; same three weights as the registry, follows the
user's icon style; unknown names render empty) · `{{join(' ', a, b)}}` —
join · `{{number(x)}}` — locale number ·
`{{duration(ms)}}` — time string · `{{inc(n)}}` — 0-based value + 1
(pipes `bytes`/`duration`/`number`/`inc`, comparisons `eq`/`ne`/`gt`/
`lt`/`gte`/`lte` also exist) · `{{if(cond, a, b)}}` — conditional ·
`{{gt(a, b)}}` — comparison · `{{source.<field>}}` — from `sourceMeta` ·
`{{file.<field>}}` — from the typed file list · `{{searchKindIcons()}}`
— the plugin's active search-kind icons. **Unknown expressions render
as the empty string** — conditional corner content is safe to write.

## Real examples

**Gallery** — one card block per media kind, with source metadata:

```jsonc
"card": {
  "image": {
    "bl": ["{{if(gt(file.count, 1), join(' ', searchKindIcons(), file.count))}}"],
    "br": ["{{source.width}}x{{source.height}}"]
  },
  "video": { "bl": ["{{duration(source.durationMs)}}", "…"], "br": ["{{source.width}}x{{source.height}}"] },
  "audio": { "bl": ["{{duration(source.durationMs)}}"] }
}
```

**Gallery** — plugin-defined search kinds (each media kind is a facet):

```jsonc
"search": { "kinds": [
  { "key": "image",     "label": "{{t('imageKindLabel')}}",     "icon": "{{icon('Image')}}"   },
  { "key": "animation", "label": "{{t('animationKindLabel')}}", "icon": "{{icon('Sparkle')}}" },
  { "key": "video",     "label": "{{t('videoKindLabel')}}",     "icon": "{{icon('Video')}}"   },
  { "key": "audio",     "label": "{{t('audioKindLabel')}}",     "icon": "{{icon('Music')}}"   }
]}
```

**PDF** — a conditional card corner plus a page-anchored message:

```jsonc
"card": {
  "default": {
    "bl": ["{{if(gt(source.pageCount, 0), join(' ', number(source.pageCount), t('pagesLabel')), 'PDF')}}"]
  }
},
"message": { "anchor": "{{t('pageAnchor')}}{{inc(data.pageIndex)}}{{t('pageSuffix')}}" }
```

## Rules of thumb

- Never ship a template's `id`; never reuse an `id` across plugins.
- Be honest with permissions — claiming `danmaku` without reading or
  writing danmaku, or `imageHashes` without the hook, wastes rescans and
  UI space.
- Card corners are metadata: quiet, small, and right-aligned by the host
  — keep them to one line.
- Treat search kinds as categories, not filter states: pick the kinds
  that partition your content meaningfully — a resource usually
  belongs to one kind — and let the kinds render the search taxonomy.
