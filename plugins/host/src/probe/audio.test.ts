// @vitest-environment node

import { describe, expect, test } from "vitest"
import { extToAudioInputFormat, parseFfprobeAudioJson } from "./audio.ts"

function payload(value: unknown): string {
	return JSON.stringify(value)
}

describe("parseFfprobeAudioJson", () => {
	test("reads stream parameters, duration and bit rate", () => {
		const info = parseFfprobeAudioJson(
			payload({
				streams: [
					{
						codec_type: "audio",
						codec_name: "flac",
						sample_rate: "44100",
						channels: 2,
					},
				],
				format: { duration: "183.456", bit_rate: "938211" },
			}),
		)
		expect(info).toEqual({
			codec: "flac",
			sampleRate: 44100,
			channels: 2,
			durationMs: 183456,
			bitRate: 938211,
		})
	})

	test("surfaces embedded artwork with its dimensions", () => {
		const info = parseFfprobeAudioJson(
			payload({
				streams: [
					{ codec_type: "audio", codec_name: "mp3" },
					{
						codec_type: "video",
						codec_name: "mjpeg",
						width: 600,
						height: 600,
						disposition: { attached_pic: 1 },
					},
				],
				format: {},
			}),
		)
		expect(info?.coverArt).toEqual({ width: 600, height: 600 })
	})

	test("a real video stream is not artwork", () => {
		const info = parseFfprobeAudioJson(
			payload({
				streams: [
					{ codec_type: "audio", codec_name: "aac" },
					{
						codec_type: "video",
						codec_name: "h264",
						width: 1920,
						height: 1080,
						disposition: { attached_pic: 0 },
					},
				],
				format: {},
			}),
		)
		expect(info?.coverArt).toBeUndefined()
	})

	test("returns undefined without an audio stream", () => {
		const info = parseFfprobeAudioJson(
			payload({
				streams: [{ codec_type: "video", codec_name: "h264" }],
				format: { duration: "10.0" },
			}),
		)
		expect(info).toBeUndefined()
	})

	test("omits fields the container does not report", () => {
		const info = parseFfprobeAudioJson(
			payload({ streams: [{ codec_type: "audio" }], format: {} }),
		)
		expect(info).toEqual({})
	})

	test("reads tags case-insensitively, container first", () => {
		const info = parseFfprobeAudioJson(
			payload({
				streams: [
					{
						codec_type: "audio",
						tags: { TITLE: "stream title", ALBUM: "stream album" },
					},
				],
				format: { tags: { Title: "format title", ARTIST: "someone" } },
			}),
		)
		expect(info?.tags).toEqual({
			title: "format title",
			artist: "someone",
			album: "stream album",
		})
	})

	test("falls back to album_artist and drops empty tag values", () => {
		const info = parseFfprobeAudioJson(
			payload({
				streams: [{ codec_type: "audio" }],
				format: { tags: { album_artist: "band", title: "" } },
			}),
		)
		expect(info?.tags).toEqual({ artist: "band" })
	})

	test("rejects a negative duration instead of persisting it", () => {
		const info = parseFfprobeAudioJson(
			payload({
				streams: [{ codec_type: "audio" }],
				format: { duration: "-1.0" },
			}),
		)
		expect(info?.durationMs).toBeUndefined()
	})
})

describe("extToAudioInputFormat", () => {
	test("maps opus onto the ogg demuxer and m4a onto mp4", () => {
		expect(extToAudioInputFormat(".opus")).toBe("ogg")
		expect(extToAudioInputFormat(".M4A")).toBe("mp4")
		expect(extToAudioInputFormat(".mp4")).toBeUndefined()
	})
})
