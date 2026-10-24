/** Native media/download capabilities never authorize application API queries. */
export function isAuthReadPath(pathname: string): boolean {
	return /^\/api\/(?:resources\/[^/]+\/(?:cover|files\/.+|source\.zip)|characters\/[^/]+\/(?:images|thumb)\/[^/]+|tags\/[^/]+\/(?:images|thumb)\/[^/]+|uploads\/staged\/[^/]+\/preview|image-search\/[^/]+\/image|cache\/trash\/[^/]+\/download)$/.test(
		pathname,
	)
}
