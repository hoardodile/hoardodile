/**
 * @vitest-environment node
 */
import { describe, expect, test } from "vitest"
import {
	estimateTranscodeBytes,
	isBrowserPlayableVideoMime,
	pickPlayableVideoUrl,
	seedFilename,
	videoMimeBase,
} from "./download.ts"

describe("seedFilename", () => {
	test("slugs Commons titles into short ASCII names", () => {
		expect(
			seedFilename("File:Van Gogh - Starry Night - Google Art Project.jpg"),
		).toBe("van-gogh-starry-night-google-art-project.jpg")
		expect(seedFilename("File:Girl with a Pearl Earring.jpg")).toBe(
			"girl-with-a-pearl-earring.jpg",
		)
		expect(seedFilename("File:Apollo 8 liftoff.ogg")).toBe(
			"apollo-8-liftoff.ogg",
		)
		expect(seedFilename("File:Boyles Law animated.gif")).toBe(
			"boyles-law-animated.gif",
		)
		expect(
			seedFilename(
				"File:NASA'S NICER Does the Space Station Twist (svs13031 crop).webm",
			),
		).toBe("nasa-s-nicer-does-the-space-station-twist-svs13031-crop.webm")
	})
})

describe("browser-playable video picks", () => {
	test("treats webm and mp4 as playable, not ogg/theora", () => {
		expect(isBrowserPlayableVideoMime("video/webm")).toBe(true)
		expect(isBrowserPlayableVideoMime('video/webm; codecs="vp9, opus"')).toBe(
			true,
		)
		expect(isBrowserPlayableVideoMime("video/mp4")).toBe(true)
		expect(isBrowserPlayableVideoMime("video/ogg")).toBe(false)
		expect(videoMimeBase('video/webm; codecs="vp9, vorbis"')).toBe("video/webm")
	})

	test("keeps a webm original that fits the cap", () => {
		expect(
			pickPlayableVideoUrl(
				[{ url: "https://example.test/a.webm", mime: "video/webm", size: 8 }],
				10,
			),
		).toBe("https://example.test/a.webm")
	})

	test("skips ogv originals and picks the largest fitting webm transcode", () => {
		expect(
			pickPlayableVideoUrl(
				[
					{ url: "https://example.test/a.ogv", mime: "video/ogg", size: 4 },
					{ url: "https://example.test/240.webm", mime: "video/webm", size: 2 },
					{ url: "https://example.test/480.webm", mime: "video/webm", size: 5 },
					{
						url: "https://example.test/1080.webm",
						mime: "video/webm",
						size: 20,
					},
				],
				10,
			),
		).toBe("https://example.test/480.webm")
	})

	test("returns undefined when nothing playable fits", () => {
		expect(
			pickPlayableVideoUrl(
				[
					{ url: "https://example.test/a.ogv", mime: "video/ogg", size: 3 },
					{
						url: "https://example.test/big.webm",
						mime: "video/webm",
						size: 40,
					},
				],
				10,
			),
		).toBeUndefined()
	})

	test("estimates transcode bytes from bitrate and duration", () => {
		expect(estimateTranscodeBytes(8_000, 2)).toBe(2_000)
		expect(estimateTranscodeBytes(311_824, 111.379)).toBe(
			Math.round((311_824 * 111.379) / 8),
		)
	})
})
