/**
 * Center-crop a still into a square JPEG. Character avatars are a 1:1
 * tile in the UI; storing a square file matches that contract so the
 * portrait is cropped rather than stretched.
 */

import sharp from "sharp"

const AVATAR_MAX_SIDE = 1600

export async function writeCenteredSquareJpeg(
	sourcePath: string,
	destPath: string,
): Promise<void> {
	const meta = await sharp(sourcePath).rotate().metadata()
	const width = meta.width
	const height = meta.height
	if (width === undefined || height === undefined || width < 1 || height < 1) {
		throw new Error(`cannot square-crop ${sourcePath}: missing dimensions`)
	}
	const side = Math.min(AVATAR_MAX_SIDE, width, height)
	await sharp(sourcePath)
		.rotate()
		.resize({
			width: side,
			height: side,
			fit: "cover",
			position: "centre",
		})
		.jpeg({ quality: 88 })
		.toFile(destPath)
}
