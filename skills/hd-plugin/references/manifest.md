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
  "permissions": { … },          // see below
  "i18n": { … },                 // see below
  "ui": { … }                    // see below
}
```

**`id`**: generate with `node -e "console.log(crypto.randomUUID())"`.
**`version`**: the plugin's own version; the app shows it (Settings →
Plugins) — bump it on user-visible changes.

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
| `container` | `listContainer`/`extractArchive` (archive entries) work; the sandbox denies these APIs without it. |
| `download` | The plugin asset vault: `download`/`statAsset`/`readAsset`/`deleteAsset` work (both sides of the plugin), *and* every download needs your per-file approval in the shared dialog. Denied by default. |

The gallery manifest shows the typical media-plugin set:
`{ "sourceMeta": true, "searchMeta": true, "danmaku": true, "message": true, "imageHashes": true }`.
A read-only viewer may ship only `sourceMeta`; the builtin file plugin adds
`"container": true` for archive listing. A plugin that ships a runtime it
cannot bundle (licensing) declares `"download": true` and fetches it on
first use — the user sees the exact URL in the consent dialog, and the
file always lands in the plugin's own `vault/` folder.

## i18n

Every user-visible string the host renders should come from `i18n`, in
both `en` and `zh` at least — the app is bilingual and untranslated
labels fall back to `name`/`description`. Keys you define for your own
labels (search kind labels, etc.) are referenced from the `ui` block:

```jsonc
"i18n": {
  "name": { "en": "PDF", "zh": "PDF" },
  "description": { "en": "Online PDF reader.", "zh": "在线 PDF 阅读器。" },
  "pagesLabel": { "en": "pages", "zh": "页" }
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
  `{{icon('<SolarGlyph>')}}` (see `hd-plugin-design` for the icon set).
- **`message.anchor`** — how an anchored message renders in the host
  (e.g. `{{duration(data.timeMs)}}` for a video timestamp). Applies only
  with the `message` permission.

### Template expressions

`{{t('key')}}` — i18n label · `{{icon('Name')}}` — registry icon ·
`{{join(' ', a, b)}}` — join · `{{number(x)}}` — locale number ·
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
