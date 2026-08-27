# @hoardodile/i18n

Single source of truth for hoardodile's UI strings. Every surface — the
web SPA, the Electron shell, the offline workbench and the plugin
iframes — reads its copy from here, so strings are authored once and
never re-typed per surface.

## Namespaces

| Namespace | Owns | Consumed by |
| --- | --- | --- |
| `translation` | App copy (pages, features, dialogs about domain objects) | web SPA, desktop shell, workbench |
| `ui` | Component chrome: control labels, aria labels, prompts ([`@hoardodile/ui`](https://www.npmjs.com/package/@hoardodile/ui) components read it via `useTranslation("ui")`) | every React surface, including plugin iframes |
| `workbench` | Offline dev-tool copy (toolbar, config popover, empty states) | `@hoardodile/workbench` only |
| `plugin` | Plugin-authored strings (declared by each plugin's own bundle) | plugin iframes |

**The boundary rule that keeps namespaces clean:** a string is *chrome*
(a part of the control: cancel/save/add labels, aria, hints) and belongs
in `ui`; a string is *feature copy* (empty states, entity names, dialog
body text about domain objects) and stays in the app. A component that
exists only to feed translated strings into something else is a smell —
`scripts/guard-i18n-wrappers.mjs` rejects alias-wrapped imports of
`@hoardodile/ui` components for that reason.

## How to add a language

1. Add the JSON catalog (`translation` + optional `ui`/`workbench`
   mirrors) for the new code in `src/catalogs/`, `src/ui/`,
   `src/workbench/`.
2. Add the code to `SUPPORTED_LANGUAGES` in `src/core.ts` (and all
   `*Catalog` registries).
3. Run the parity test — every catalog must carry the exact key set,
   interpolation placeholders, plural pairs, markup tags and ellipsis
   style; the strict lockstep rules are what keep a half-translated
   language from shipping.

## How to add a namespace

`<name>/<lang>.json` ×5 → registry `src/catalogs/<name>.ts`
(`Record<SupportedLanguage, typeof en>` — key drift becomes a compile
error) → tsup entry → exports subpath → `parity.test.ts` adds one
`checkCatalogLockstep(...)` call.

## Subpath guide

| Subpath | Contents | Who imports it |
| --- | --- | --- |
| `.` | Helpers `isSupportedLanguage` / `resolveSystemLanguage` / `SUPPORTED_LANGUAGES`, the `createI18n` host factory (preloaded translation + ui resources), the typed `i18next` augmentation | hosts (web, desktop wizard, workbench) |
| `./core` | Catalog-free helpers only | sandboxed Electron preload |
| `./create-i18n` | `createI18n` factory without default resources | plugin iframes (own resources) |
| `./react` | `I18nProvider` / `setI18n` bound to one react-i18next copy | hosts, tests |
| `./catalogs` | App catalogs (`CATALOGS`, `catalogFor`) | Electron main (native dialogs), tests |
| `./catalogs/ui` | ui chrome catalogs (`UI_CATALOGS`, `uiCatalogFor`) | plugin SDK, workbench |
| `./workbench` | Dev-tool catalogs (`WORKBENCH_CATALOGS`, `workbenchCatalogFor`) | workbench only |

## Known pitfalls

- **Instance identity.** The workspace pins two typescript toolchains
  (`5.9.3` for tsup-built packages, `7.0.2` for the rest); i18next peers
  on typescript, so pnpm materializes **two physical copies** of
  i18next/react-i18next. Never rely on react-i18next's module-global
  default across package boundaries — pass the instance explicitly
  (`<I18nProvider i18n={…}>`), and expect narrow casts where the two
  type identities meet.
- **Wire payloads beat the type table.** The `languageChanged` push is a
  *bare language-code string* — it predates the typed protocol table and
  must stay stable; `HostPushes` follows the wire. Tests mock real
  payload shapes (sdk-react accepts both shapes for compatibility).
- **`translation` vs `ui` key duplication is intentional.** The same word
  can exist in both namespaces (e.g. `common.cancel` and `dialog.cancel`)
  when one consumer is app code and the other is component chrome — the
  duplication is per-namespace ownership, not copy-paste drift.
- **Deliberate exception:** workbench `describeContext` status lines stay
  English (developer diagnostics; `scripts/smoke-published.mjs` asserts
  `detect ok`).

Plugin authors: use `createPluginTranslation` from `@hoardodile/sdk-react`
for the zero-config path, or assemble your own react-i18next instance —
the only hoardodile piece you need is the host language notification
(`getPluginContext().language` + the `languageChanged` push). See
`skills/hd-plugin/references/client.md`.
