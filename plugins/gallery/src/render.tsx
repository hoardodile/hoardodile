import "./index.css"

import { createPluginRoot, useVisibility } from "@hoardodile/sdk-react"
import { useMemo } from "react"
import { GalleryView } from "./GalleryView"
import { normalizeGalleryFiles, readGalleryPreviews } from "./helpers"
import { PluginAPIProvider, usePluginAPI } from "./hooks"

function GalleryPreview() {
	const api = usePluginAPI()
	const visible = useVisibility()
	const { data: files } = api.useFileList()

	const previewFiles = useMemo(
		() => readGalleryPreviews(api.resource.sourceMeta) ?? [],
		[api.resource.sourceMeta],
	)

	const mediaFiles = normalizeGalleryFiles(files) ?? previewFiles
	const expectedCount = api.resource.fileStats?.count

	// Keep rendering while parked (invisible): the host's preview window
	// pre-paints neighbor slots offscreen so a flip is a style swap, and
	// an empty tree here would defeat that prerender. Visibility only
	// gates playback — autoplay is suppressed and any playing media is
	// paused while parked.
	const playerOptions = useMemo(
		() => ({
			autoplay: visible ? undefined : false,
			playing: visible ? undefined : false,
		}),
		[visible],
	)

	return (
		<GalleryView
			mediaFiles={mediaFiles}
			onCurrentFileChange={() => {}}
			hideSendBar={false}
			expectedCount={expectedCount}
			playerOptions={playerOptions}
		/>
	)
}

createPluginRoot({ provider: PluginAPIProvider, render: GalleryPreview })
