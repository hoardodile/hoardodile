# @hoardodile/plugin-gallery

Media gallery content plugin: probes images, video and audio, and renders
a viewer with a bullet-comment ("danmaku") video player.

## Dev loop

This plugin is developed entirely through the plugin toolchain — no
hoardodile server, no web app:

```bash
pnpm build          # bundle manifest + client + server hooks into dist/
pnpm dev            # watch-build and serve the workbench (http://127.0.0.1:5199)
pnpm detect:smoke   # run detect against testdata/ through the real sandbox
pnpm test           # vitest
```

`pnpm dev` captures the server-side hook results (`detect`, `sourceMeta`,
`searchMeta`, `listFiles`, `coverLocal`) from the real worker sandbox and
feeds them to the workbench, so the iframe receives the same context the
app would push. Individual hooks can also be run or benchmarked directly:

```bash
pnpm exec hoardodile plugin run listFiles testdata --plugin-dir dist
pnpm exec hoardodile plugin bench sourceMeta testdata --plugin-dir dist
```

## testdata/

A committed synthetic fixture resource covering every search facet the
plugin reports — still images at three aspect ratios, an animation, a
short video clip and an audio tone. Nothing in it is copied from
anywhere: `pnpm testdata` regenerates it (the clip and animation need an
ffmpeg binary; the committed files mean a fresh clone never does).

To iterate against real content instead, point the dev loop at a
hoardodile data root — it is opened read-only and adds a resource picker
to the workbench header:

```bash
pnpm exec hoardodile plugin dev --storage ~/hoardodile-data
```
