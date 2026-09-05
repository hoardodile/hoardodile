export function jobErrorKey(error: { code: string; message: string }) {
	if (error.code === "low_disk") return "protectionUx.errorSpace" as const
	if (
		[
			"certificate_changed",
			"invalid_fingerprint",
			"certificate_missing",
		].includes(error.code)
	)
		return "protectionUx.errorCertificate" as const
	if (["peer_unauthorized", "invalid_invitation"].includes(error.code))
		return "protectionUx.errorPairing" as const
	if (
		["sender_unavailable", "transport_closed", "peer_error"].includes(
			error.code,
		) ||
		/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/.test(error.message)
	)
		return "protectionUx.errorNetwork" as const
	if (error.code === "incomplete_backup")
		return "protectionUx.errorIncomplete" as const
	return "protectionUx.taskFailed" as const
}
