import { createHash } from "node:crypto"

export { isAuthReadPath as isReadTokenPath } from "@hoardodile/shared"

/** Only native media/download routes may accept a URL capability. */

/** Bind to the exact pathname; query options cannot broaden its resource. */
export function readTokenScope(pathname: string): string {
	return createHash("sha256").update(pathname).digest("base64url")
}
