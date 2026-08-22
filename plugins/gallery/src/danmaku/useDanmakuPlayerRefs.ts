import type Danmaku from "danmaku"
import { useRef, useState } from "react"

/**
 * The element handles the enhanced player threads through its subtree:
 * the media element, the danmaku overlay stage, the engine instance,
 * and the portal container.
 *
 * The portal container is mirrored into state because popovers and
 * selects must render *inside* the player element to stay visible (and
 * tappable) in fullscreen — a ref alone would not re-render the context
 * consumers once the container mounts.
 */
export function useDanmakuPlayerRefs() {
	const videoRef = useRef<HTMLVideoElement>(null)
	const stageRef = useRef<HTMLDivElement>(null)
	const danmakuRef = useRef<Danmaku | undefined>(undefined)
	const [portalContainer, setPortalContainer] = useState<
		HTMLElement | undefined
	>(undefined)
	return {
		videoRef,
		stageRef,
		danmakuRef,
		portalContainer,
		setPortalContainer,
	}
}
