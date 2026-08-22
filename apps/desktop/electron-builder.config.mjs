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
	productName: "Hoardodile",
	copyright: "Copyright © wooloo26",
	extraMetadata: {
		name: "hoardodile",
		version,
		main: "./out/main/index.js",
	},
	directories: {
		output: "release",
	},
	files: ["out/**"],
	extraResources: [
		{ from: "extra-resources/node", to: "node" },
		{ from: "extra-resources/server", to: "server" },
		{ from: "extra-resources/plugins", to: "plugins" },
		{ from: "extra-resources/icon.png", to: "icon.png" },
		{ from: "extra-resources/tray.png", to: "tray.png" },
	],
	asar: true,
	npmRebuild: false,
	nodeGypRebuild: false,
	removePackageScripts: true,
	electronLanguages: ["en-US", "zh-CN"],
	win: {
		icon: "resources/icon.ico",
		verifyUpdateCodeSignature: false,
		target: [
			{ target: "nsis", arch: ["x64"] },
			{ target: "zip", arch: ["x64"] },
		],
	},
	nsis: {
		oneClick: false,
		allowToChangeInstallationDirectory: true,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder packer tokens
		artifactName: "${productName}-Setup-${version}-${arch}.${ext}",
	},
	publish: {
		provider: "github",
		owner: "hoardodile",
		repo: "hoardodile",
		// Attach to the GitHub Release `pnpm release` already published;
		// the default `draft` would open a second, unpublished release.
		releaseType: "release",
	},
}

export default config
