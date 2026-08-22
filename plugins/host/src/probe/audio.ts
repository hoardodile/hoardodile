import type { Readable } from "node:stream"
import { AUDIO_FFMPEG_INPUT_FORMAT } from "@hoardodile/sdk-types/media-exts"
import type { AudioCoverArt, AudioInfo, AudioTags } from "../types.ts"
import {
	type FfprobePayload,
	type FfprobeStream,
	ffprobeDurationMs,
	ffprobeInt,
	getFfprobePath,
	parseFfprobePayload,
	runFfprobeJson,
} from "./ffprobe.ts"

/**
 * Audio probing via ffprobe (see `ffprobe.ts` for path resolution and the
 * process plumbing). One probe answers everything the host needs about an
 * audio file: playable duration, stream parameters, whether the container
 * carries embedded artwork, and the human-facing tags.
 */

/** Resolve an extension to its ffmpeg `-f` container name for piped input. */
export function extToAudioInputFormat(ext: string): string | undefined {
	return AUDIO_FFMPEG_INPUT_FORMAT[ext.toLowerCase()]
}

/**
 * Pure parser; broken out so callers and tests can hit it without
 * spawning ffprobe. Returns `undefined` when the payload carries no
 * audio stream at all — a video file probed as audio must not produce a
 * half-filled result.
 */
export function parseFfprobeAudioJson(json: string): AudioInfo | undefined {
	return audioInfoFromPayload(parseFfprobePayload(json))
}

export function audioInfoFromPayload(
	payload: FfprobePayload,
): AudioInfo | undefined {
	const streams = payload.streams ?? []
	const audioStream = streams.find((s) => s.codec_type === "audio")
	if (audioStream === undefined) return undefined

	const result: {
		durationMs?: number
		codec?: string
		bitRate?: number
		sampleRate?: number
		channels?: number
		coverArt?: AudioCoverArt
		tags?: AudioTags
	} = {}

	const durationMs = ffprobeDurationMs(payload.format)
	if (durationMs !== undefined) result.durationMs = durationMs
	if (
		typeof audioStream.codec_name === "string" &&
		audioStream.codec_name.length > 0
	) {
		result.codec = audioStream.codec_name
	}
	const bitRate = ffprobeInt(payload.format?.bit_rate)
	if (bitRate !== undefined) result.bitRate = bitRate
	const sampleRate = ffprobeInt(audioStream.sample_rate)
	if (sampleRate !== undefined) result.sampleRate = sampleRate
	const channels = ffprobeInt(audioStream.channels)
	if (channels !== undefined) result.channels = channels
	const picture = streams.find(isAttachedPicture)
	if (picture !== undefined) {
		result.coverArt = {
			width: ffprobeInt(picture.width),
			height: ffprobeInt(picture.height),
		}
	}
	const tags = readAudioTags(payload)
	if (tags !== undefined) result.tags = tags

	return result
}

/**
 * True for the still image ffmpeg exposes as a video stream: ID3 APIC
 * frames, FLAC PICTURE blocks and MP4 `covr` atoms all surface this way.
 */
function isAttachedPicture(stream: FfprobeStream): boolean {
	if (stream.codec_type !== "video") return false
	const disposition = stream.disposition
	if (typeof disposition !== "object" || disposition === null) return false
	return (disposition as Record<string, unknown>).attached_pic === 1
}

/**
 * Read the well-known tags off the container, falling back to the audio
 * stream's own tag table (Vorbis comments in Matroska/Ogg land there).
 * Tag keys vary in case between muxers, so lookups are case-insensitive.
 */
function readAudioTags(payload: FfprobePayload): AudioTags | undefined {
	const tables = [
		payload.format?.tags,
		payload.streams?.find((s) => s.codec_type === "audio")?.tags,
	]
	const lookup = new Map<string, string>()
	for (const table of tables) {
		if (typeof table !== "object" || table === null) continue
		for (const [key, value] of Object.entries(table)) {
			if (typeof value !== "string" || value.length === 0) continue
			const normalized = key.toLowerCase()
			if (!lookup.has(normalized)) lookup.set(normalized, value)
		}
	}
	const tags: { title?: string; artist?: string; album?: string } = {}
	const title = lookup.get("title")
	if (title !== undefined) tags.title = title
	const artist = lookup.get("artist") ?? lookup.get("album_artist")
	if (artist !== undefined) tags.artist = artist
	const album = lookup.get("album")
	if (album !== undefined) tags.album = album
	return Object.keys(tags).length === 0 ? undefined : tags
}

/**
 * Probe an audio stream or path with ffprobe. Probe failures — a missing
 * binary, an unreadable container, or a source with no audio stream —
 * return `undefined` so callers can treat "not yet probed" and "probe
 * failed" the same way.
 */
export async function probeAudio(
	source: string | Readable,
	extHint?: string,
): Promise<AudioInfo | undefined> {
	try {
		const inputFormat =
			typeof source === "string" || extHint === undefined
				? undefined
				: extToAudioInputFormat(extHint)
		const payload = await runFfprobeJson(source, getFfprobePath(), inputFormat)
		return audioInfoFromPayload(payload)
	} catch {
		return undefined
	}
}
