export const OPTIONAL_BIN_PACKAGES: readonly [
	"@hoardodile/ffmpeg-bin",
	"@hoardodile/ffprobe-bin",
	"@hoardodile/7z-bin",
	"@hoardodile/restic-bin",
	"@hoardodile/rclone-bin",
]

export function assertCopiedMediaBins(nodeModulesDir: string): void
