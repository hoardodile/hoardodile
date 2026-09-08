# Mobile overlay back navigation

Mobile overlays use the **top window's viewport**, below 768 CSS pixels. Back
closes the top layer; forward does not reopen a dismissed layer. Opening an
overlay creates session-history entries and therefore discards an existing
forward branch. This is intentional, including on a page opened directly.

## Ownership and integration

- `mobile-back-stack.ts` owns live registrations, activation identities and
  parent-before-child ordering. Removed registrations are swept after the
  current React commit, so StrictMode cleanup does not create another opening.
- `mobile-back-controller.ts` owns physical history snapshots and serializes
  internal traversal to a specific destination. Route identity is separate from
  URL, so two real entries with the same URL remain distinct. A route replacement
  updates the meaning of that route's old synthetic snapshots.
- `mobile-back-browser.ts` owns one controller and one pop listener per top
  window. It does not patch global history methods. An iframe never creates a
  browser controller through the hook's default path.
- `useMobileBackToClose(open, onOpenChange)` retains its call signature.
  Component roots use `MobileBackScope` to preserve ancestry across portals.
  `MobileBackProvider` supplies a controller or an iframe message registry.
- The SPA explicitly creates `createMobileBackHistory(controller)` and passes
  it to TanStack Router. Application navigation must use that router/history
  adapter. It filters overlay traversals before router notifications and leave
  blockers, and supports push, replace, back, forward and go. Programmatic
  navigation's explicit `ignoreBlocker` option remains supported.
- `setNavigationResolver` is a deprecated, inert compatibility export.
  Applications previously using it must migrate their router integration.
  Merely registering a resolver no longer installs a global history patch.

Controlled overlays that reject a back-close request remain registered and get
their back protection restored. A route navigation retires its old
registrations. A viewport change removes/restores history protection without
closing still-visible UI.

## Plugin lifecycle

`createPluginRoot` automatically installs the SDK's iframe registry. Hosts
advertise an optional `overlaySession` in the context. The additive
`overlaySync` request sends a revisioned snapshot; `overlayClose` requests a
close; `overlaySession` starts/ends a resource binding's lifetime.

The SPA and Workbench share `createOverlayHost`. Inbound messages retain the
existing source/resource validation, and registration additionally checks the
session and revision. Release, resource replacement and destruction remove
registrations; temporary visibility changes do not. Late messages from an old
binding cannot affect its replacement.

Rebuild plugins against the updated SDK/UI to receive this fix. Already-built
plugins still contain their old hook. A new SDK running under a host without the
capability leaves ordinary UI close controls available and does not touch iframe
history.

## Regression coverage and commands

The original five hook tests passed before this work. Added tests exposed
child-first mounting closing the parent, nested UI-close history corruption, and
route replacement leaving an overlay open. The retained tests use real component
roots; the route replacement test now goes through the explicit navigation port.

| Layer | Permanent regression tests |
| --- | --- |
| Controller | `packages/ui/src/lib/mobile-back-controller.test.ts`: real-entry identity; parent/child order; close/reopen loops; lower/middle removal; parent reopen; StrictMode-style handoff; in-flight close/reopen and navigation; queued backs; go(-2); forward tail; replace/forward; refused close; responsive activation; reload; unknown states; failed writes; late blocker results |
| React | `packages/ui/src/hooks/{useMobileBackToClose,mobile-back.regression}.test.tsx` and `components/mobile-back.test.tsx`: real nested dialogs, committed callback updates, StrictMode, uncontrolled wrappers and submenu registration |
| Router | `apps/web/src/lib/mobile-back-history.test.tsx`: real TanStack Router and document guard; no overlay loaders/confirm; blocked push/replace; multi-step rollback; explicit blocker bypass |
| Bridge | SDK and host `mobile-overlays.test.ts`: scoped identities, revisions, close acknowledgment/refusal, visibility, release/rebind, old messages and missing capability |
| Browser | `apps/web/e2e/mobile-back/history.spec.ts`: Chromium and WebKit, real history and sandbox iframe, nested dialogs, repeated reopen, menu handoff, forward, refresh, dirty guard, pending reopen, replacement, host viewport |

Run after a build:

```sh
pnpm -F @hoardodile/ui test
pnpm -F @hoardodile/web exec vitest run src/lib/mobile-back-history.test.tsx
pnpm -F @hoardodile/sdk-web test
pnpm -F @hoardodile/host-web test
pnpm -F @hoardodile/web exec playwright install chromium webkit
pnpm -F @hoardodile/web test:mobile-back
pnpm sdks:pack
```

The browser fixture uses production components, SDK bootstrap and router adapter
with a local mock host. It has a separate configuration and no database/server
setup. CI runs both engines. Do not format/rebuild watched fixture dependencies
in the middle of a browser run: a development reload invalidates its history.

## Device acceptance record

Implementation verification on 2026-09-08:

- All six affected package suites passed. The final UI run passed 218 tests in
  29 files. SDK Web passed 17, host Web 39, SDK React 11 and Workbench 145.
- The complete Web suite passed 1,279 tests; after subsequent boundary fixes,
  the six directly related Web files passed all 96 tests.
- The final Chromium/WebKit fixture run passed all 16 cases. Existing application
  browser checks passed four navigation/scroll cases, the diagnostics case, and
  the startup error-page case (the latter after fixing early media-query access).
- The root build passed all 22 tasks, the final root lint passed all 43 tasks,
  and SDK closure validation/packing produced all 11 expected tarballs.

**Not yet run on physical devices.** Playwright's mobile Chromium/WebKit results
are not Android hardware-back or iPhone edge-swipe results.

On Android Chrome and iPhone Safari, record OS/browser versions and check:

1. Open a page directly, open a dialog, perform the system back/edge-swipe:
   only the dialog closes. Open it again and repeat.
2. Open parent and child dialogs. Back closes child, then parent, then page.
   Repeat after closing the child using its button.
3. Cancel an iPhone interactive edge-swipe: the UI and history remain at the
   origin. Complete the next swipe and confirm one layer closes.
4. Open a plugin overlay inside a preview, then a host overlay. Unwind both;
   close/reopen the preview and repeat after rotating the device.
5. On a dirty document, overlay back does not prompt; page departure does.
6. Background/resume the browser while an overlay is open, then back and reopen.

Also check the installed PWA on each supported device if shipped in that mode.
