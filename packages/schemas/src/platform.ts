import { z } from "zod"

/**
 * Client platform through which the user accesses the app. Shared by
 * every domain that records device context (usage sessions, footprints).
 *
 * - `web-mobile` — web client on a mobile or tablet browser.
 * - `web-pc` — web client on a desktop browser.
 * - `desktop` — native desktop app.
 */
export const clientPlatform = z.enum(["web-mobile", "web-pc", "desktop"])
export type ClientPlatform = z.infer<typeof clientPlatform>
