import type { ClientPlatform } from "@hoardodile/schemas"
import Bowser from "bowser"
import { isHoardodileDesktop } from "@/lib/desktop"

/**
 * Detect the platform for usage analytics.
 *
 * The Electron preload bridge reports `desktop`. Mobile and tablet
 * browsers report `web-mobile`; everything else (including UA parsing
 * failures) reports `web-pc`.
 */
export function detectPlatform(): ClientPlatform {
	if (isHoardodileDesktop()) return "desktop"
	const hints = (navigator as { userAgentData?: Bowser.ClientHints })
		.userAgentData
	const parser = Bowser.getParser(navigator.userAgent, hints)
	const platformType = parser.getPlatformType()
	return platformType === "mobile" || platformType === "tablet"
		? "web-mobile"
		: "web-pc"
}
