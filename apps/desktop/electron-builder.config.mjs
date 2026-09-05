import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const desktopRoot = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(desktopRoot, "../..")
const rootPkg = JSON.parse(
	readFileSync(resolve(workspaceRoot, "package.json"), "utf8"),
)
const version = typeof rootPkg.version === "string" ? rootPkg.version : "0.0.0"

/** @type {import('electron-builder').Configuration} */
const config = {
	appId: "com.hoardodile.app",
	productName: "hoardodile",
	copyright: "Copyright © wooloo26",
	extraMetadata: {
		name: "hoardodile",
		version,
		main: "./out/main/index.js",
	},
	directories: {
		output: "release",
	},
	// The shell bundles everything it imports (vite ssr noExternal; only
	// "electron" and node builtins stay external) — the app itself needs
	// no node_modules. Without this negation electron-builder walks the
	// pnpm store and asar-copies the whole production dependency tree
	// (tens of thousands of files) that the runtime never reads. The
	// sidecar's deps live in extraResources/server, never in the asar.
	files: ["out/**", "!node_modules/**"],
	// One entry for the whole staged tree, never per-resource: electron-builder
	// drops a `node_modules` that sits at the ROOT of an extraResources copy
	// (app-builder-lib filter: relative === "node_modules" is excluded), but
	// keeps nested ones. With `from: "extra-resources"` the staged
	// `server/node_modules` is nested and survives; the output layout is
	// unchanged (resources/{node,server,plugins,icon.png,tray.png}).
	extraResources: [{ from: "extra-resources" }],
	asar: true,
	npmRebuild: false,
	nodeGypRebuild: false,
	removePackageScripts: true,
	electronLanguages: ["en-US", "zh-CN"],
	win: {
		icon: "resources/icon.ico",
		verifyUpdateCodeSignature: false,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder packer tokens
		artifactName: "${productName}-${version}-windows-${arch}.${ext}",
		target: [
			{ target: "nsis", arch: ["x64"] },
			{ target: "zip", arch: ["x64"] },
		],
	},
	mac: {
		// Prebuilt icns (generated once via electron-builder's icon-tool from
		// icon.png): giving the icns directly skips the png→icns conversion.
		// The converter is a downloaded CJS script that crashes as ESM when
		// extracted under this workspace — its nearest package.json is the
		// repo root with "type": "module" (see .cache/electron-builder).
		icon: "resources/icon.icns",
		// No certificate in this phase: electron-builder ad-hoc signs the
		// arm64 bundle so macOS accepts it (notarization comes with a
		// real identity later). The shell's `autoUpdate` default is OFF on
		// macOS until signed & notarized builds exist — see config.ts.
		identity: null,
		category: "public.app-category.productivity",
		target: [
			{ target: "dmg", arch: ["arm64"] },
			// The zip is electron-updater's macOS update artifact.
			{ target: "zip", arch: ["arm64"] },
		],
		// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder packer tokens
		artifactName: "${productName}-${version}-macos-${arch}.${ext}",
	},
	linux: {
		icon: "resources/icon.png",
		category: "Utility",
		executableName: "hoardodile",
		target: ["AppImage"],
		// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder packer tokens
		artifactName: "${productName}-${version}-linux-${arch}.${ext}",
	},
	nsis: {
		oneClick: false,
		allowToChangeInstallationDirectory: true,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder packer tokens
		artifactName: "${productName}-${version}-windows-${arch}-setup.${ext}",
	},
	publish: {
		provider: "github",
		owner: "hoardodile",
		repo: "hoardodile",
		// Default `draft` — the release-it-created draft is the review gate:
		// a human finalizes it on GitHub before electron-updater sees it.
	},
}

export default config
