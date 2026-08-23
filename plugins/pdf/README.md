# @hoardodile/plugin-pdf

Official hoardodile content plugin: an online PDF reader. Renders `.pdf`
documents in the plugin iframe with paged scrolling, zoom and fit modes,
rotation, an optional text layer for copy/selection, and per-page comment
anchors — all inside the host's design system (`@hoardodile/ui`), with
zero network calls beyond the host's own tokenized file URLs.

## What a resource is

A resource containing at least one `.pdf` file whose first bytes carry
the `%PDF-` magic header (extension alone never wins — renamed HTML stays
unclaimed). Resources with several PDFs get a file selector in the
viewer.

## Dev loop

Developed entirely through the plugin toolchain — no hoardodile server,
no web app:

```bash
pnpm build                # bundle manifest + client + server hooks into dist/
pnpm dev                  # watch-build and serve the workbench (http://127.0.0.1:5199)
pnpm testdata             # regenerate synthetic PDF fixtures (scripts/make-testdata.mjs)
pnpm test                 # vitest (detect / sourceMeta / anchor decoding)
pnpm run detect:smoke     # run detect against testdata/ through the real sandbox
```

`pnpm dev` captures the server-side hook results (`detect`,
`sourceMeta`, `listFiles`) from the real worker sandbox and feeds them
to the workbench, so the iframe receives the same context the app would
push.

## Architecture

- `src/main.ts` — server hooks: `detect` (extension + `%PDF-` magic),
  `sourceMeta` (file list, total size, version, best-effort page count),
  `listFiles` (typed entries with sizes).
- `src/page-count.ts` — the cheap page-count scan: counts `/Type /Page`
  objects, ignoring the `/Type /Pages` tree. Best effort by design —
  PDFs with compressed object streams undercount, so cards show the
  estimate and the viewer always shows the exact `numPages` once loaded.
- `src/pdf.ts` — pdf.js bootstrap: module worker (asset URL, falling
  back to a blob URL for the sandbox's opaque origin) plus document
  opening: progressive range streaming through the host file URL
  (CORS `*` + HTTP Range), falling back to an in-memory read only for
  files ≤ 96 MB.
- `src/PdfViewer.tsx` — the iframe UI: virtualized page rendering
  (IntersectionObserver, canvases created only for visible pages),
  toolbar (page nav, zoom in/out, fit-width/fit-page/actual, rotate,
  text layer toggle, download), plugin-`usePref` persistence for fit
  mode/scale/rotation/text layer.
- `src/anchor.ts` + manifest `message.anchor` — comments can be anchored
  to a page (`{{inc(data.pageIndex)}}`), and clicking an anchor in the
  host UI jumps the viewer to that page.

## Known limitations

- Page counts in `sourceMeta` are a best-effort scan (see above); large
  PDFs (> 8 MB) report no estimate at all — the viewer's exact count
  wins.
- The text layer approximates fonts (sans-serif metrics); exact glyph
  shapes remain canvas-only, and CJK cMap support is not bundled —
  copying from some CJK PDFs may be degraded.
- No OCR, no full-text search, no thumbnails in v1 — the pluggable
  extension points are `imageHashes` (future) and client-side parsing.

## License

GPL-3.0-only (matching the hoardodile repository). `pdfjs-dist` is
Apache-2.0.
