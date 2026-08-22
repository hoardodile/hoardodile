#!/usr/bin/env node
/**
 * Regenerate `testdata/` — the fixture resource the gallery plugin is
 * developed against (`pnpm dev`, `pnpm detect:smoke`, `hoardodile plugin
 * bench`). The generated files are committed, so this only needs running
 * when the fixture itself should change.
 *
 * Everything is synthetic: gradients, a sine tone, an inline SVG, and
 * (when an ffmpeg binary can be found) a two-second clip, a short
 * animation, a TIFF still, an AAC tone and a 3GP clip, so the fixture
 * exercises all four search facets — image, animation, video, audio —
 * and the extended mainstream formats.
 *
 * Usage: node scripts/make-testdata.mjs
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { crc32, deflateSync } from "node:zlib"

const OUT_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"testdata",
)

// ── PNG ──────────────────────────────────────────────────────────────────

function pngChunk(type, data) {
	const body = Buffer.concat([Buffer.from(type, "latin1"), data])
	const out = Buffer.alloc(body.length + 8)
	out.writeUInt32BE(data.length, 0)
	body.copy(out, 4)
	out.writeUInt32BE(crc32(body), body.length + 4)
	return out
}

/**
 * Minimal 8-bit truecolour PNG. `shade(x, y)` returns `[r, g, b]`; each
 * scanline uses filter type 0 (none), which keeps the encoder to a
 * single deflate call.
 */
function encodePng(width, height, shade) {
	const stride = width * 3 + 1
	const raw = Buffer.alloc(stride * height)
	for (let y = 0; y < height; y++) {
		const rowStart = y * stride
		for (let x = 0; x < width; x++) {
			const [r, g, b] = shade(x, y)
			raw[rowStart + 1 + x * 3] = r
			raw[rowStart + 2 + x * 3] = g
			raw[rowStart + 3 + x * 3] = b
		}
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 2 // colour type: truecolour
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(raw, { level: 9 })),
		pngChunk("IEND", Buffer.alloc(0)),
	])
}

/**
 * Coarse colour blocks rather than a per-pixel gradient: large flat runs
 * keep the deflated PNG in the low kilobytes while still giving each
 * fixture image a distinct look.
 */
function blocks(hueShift) {
	const size = 20
	return (x, y) => {
		const bx = Math.floor(x / size)
		const by = Math.floor(y / size)
		return [
			(bx * 37 + hueShift) % 256,
			(by * 53 + hueShift * 2) % 256,
			((bx + by) * 29 + hueShift * 3) % 256,
		]
	}
}

// ── WAV ──────────────────────────────────────────────────────────────────

/** 8 kHz mono 16-bit PCM sine tone. */
function encodeWav(seconds, frequencyHz) {
	const sampleRate = 8000
	const frames = sampleRate * seconds
	const data = Buffer.alloc(frames * 2)
	for (let i = 0; i < frames; i++) {
		const value = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate)
		data.writeInt16LE(Math.round(value * 12000), i * 2)
	}
	const header = Buffer.alloc(44)
	header.write("RIFF", 0, "latin1")
	header.writeUInt32LE(36 + data.length, 4)
	header.write("WAVEfmt ", 8, "latin1")
	header.writeUInt32LE(16, 16) // fmt chunk size
	header.writeUInt16LE(1, 20) // PCM
	header.writeUInt16LE(1, 22) // mono
	header.writeUInt32LE(sampleRate, 24)
	header.writeUInt32LE(sampleRate * 2, 28) // byte rate
	header.writeUInt16LE(2, 32) // block align
	header.writeUInt16LE(16, 34) // bits per sample
	header.write("data", 36, "latin1")
	header.writeUInt32LE(data.length, 40)
	return Buffer.concat([header, data])
}

// ── ffmpeg-backed fixtures ───────────────────────────────────────────────

/**
 * An ffmpeg binary, if one can be found: PATH first, then the ffmpeg-static
 * package a hoardodile checkout already has. Absent is fine — the clip
 * and animation are committed, so a fresh clone never re-encodes them.
 */
function findFfmpeg() {
	const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" })
	if (probe.status === 0) return "ffmpeg"
	const require = createRequire(import.meta.url)
	for (const pkg of ["ffmpeg-static"]) {
		try {
			const resolved = require(pkg)
			const path = typeof resolved === "string" ? resolved : resolved.path
			if (typeof path === "string" && existsSync(path)) return path
		} catch {
			// not installed here
		}
	}
	return undefined
}

function runFfmpeg(binary, args, label) {
	const result = spawnSync(binary, ["-y", "-loglevel", "error", ...args], {
		stdio: "inherit",
	})
	if (result.status !== 0) {
		console.warn(`[testdata] ffmpeg failed to write ${label}`)
	}
}

// ── main ─────────────────────────────────────────────────────────────────

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

const images = [
	["010-wide.png", 320, 180, 0],
	["020-tall.png", 180, 320, 40],
	["030-square.png", 256, 256, 90],
]
for (const [name, width, height, hue] of images) {
	writeFileSync(join(OUT_DIR, name), encodePng(width, height, blocks(hue)))
}
writeFileSync(
	join(OUT_DIR, "045-vector.svg"),
	[
		'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80">',
		'  <rect width="120" height="80" fill="#2a4a6a"/>',
		'  <circle cx="60" cy="40" r="28" fill="#d4a017"/>',
		"</svg>",
		"",
	].join("\n"),
)
writeFileSync(join(OUT_DIR, "060-tone.wav"), encodeWav(1, 440))

const ffmpeg = findFfmpeg()
if (ffmpeg === undefined) {
	console.warn(
		"[testdata] no ffmpeg binary found — skipping the video, animation, TIFF, AAC and 3GP fixtures.",
	)
} else {
	runFfmpeg(
		ffmpeg,
		[
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=160x120:rate=10:duration=2",
			"-pix_fmt",
			"yuv420p",
			"-c:v",
			"libx264",
			"-preset",
			"veryslow",
			"-crf",
			"40",
			"-movflags",
			"+faststart",
			join(OUT_DIR, "050-clip.mp4"),
		],
		"050-clip.mp4",
	)
	runFfmpeg(
		ffmpeg,
		[
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=64x64:rate=5:duration=1",
			"-loop",
			"0",
			join(OUT_DIR, "040-loop.gif"),
		],
		"040-loop.gif",
	)
	runFfmpeg(
		ffmpeg,
		[
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=64x48:rate=1:duration=1",
			"-frames:v",
			"1",
			"-c:v",
			"tiff",
			join(OUT_DIR, "055-photo.tiff"),
		],
		"055-photo.tiff",
	)
	runFfmpeg(
		ffmpeg,
		[
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=660:duration=1",
			"-c:a",
			"aac",
			"-b:a",
			"32k",
			"-f",
			"adts",
			join(OUT_DIR, "065-tone.aac"),
		],
		"065-tone.aac",
	)
	runFfmpeg(
		ffmpeg,
		[
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=96x72:rate=10:duration=1",
			"-c:v",
			"mpeg4",
			"-q:v",
			"8",
			"-c:a",
			"aac",
			"-b:a",
			"32k",
			"-f",
			"3gp",
			join(OUT_DIR, "070-clip.3gp"),
		],
		"070-clip.3gp",
	)
}

writeFileSync(
	join(OUT_DIR, "README.md"),
	[
		"# gallery testdata",
		"",
		"Synthetic fixture resource for the offline dev loop. Regenerate with",
		"`pnpm testdata` (`node scripts/make-testdata.mjs`).",
		"",
		"Covers every search facet the plugin reports: still images, an",
		"animation, a video clip and an audio track, plus the extended",
		"mainstream formats (SVG, TIFF, 3GP, AAC).",
		"",
	].join("\n"),
)

// The fixture directory is resource content, nothing else: a stray
// README would show up in listFiles and inflate fileStats. The fixture
// is documented in the plugin README instead.
console.log(`[testdata] wrote ${OUT_DIR}`)
