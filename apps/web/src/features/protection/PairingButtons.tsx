import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Input } from "@hoardodile/ui/components/input"
import { Textarea } from "@hoardodile/ui/components/textarea"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useToastMutation } from "@/hooks/useToastMutation"
import { getDesktopBridge } from "@/lib/desktop"
import { trpcMutation } from "@/trpc/factory"
import {
	formatPairingInvitation,
	parsePairingInvitation,
} from "./pairing-invitation"

export function ConnectSenderButton({
	onConnected,
}: {
	onConnected: () => Promise<void>
}) {
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const [text, setText] = useState("")
	const [manual, setManual] = useState(false)
	const [url, setUrl] = useState("")
	const [code, setCode] = useState("")
	const [fingerprint, setFingerprint] = useState("")
	const parsed = parsePairingInvitation(text)
	const input = manual
		? {
				url: url.trim(),
				code: code.trim(),
				fingerprint: fingerprint.trim() || undefined,
			}
		: parsed
	const connect = useToastMutation({
		...trpcMutation("replication", "connect"),
		onSuccess: async () => {
			setOpen(false)
			setText("")
			setCode("")
			await onConnected()
		},
	})
	return (
		<>
			<Button onClick={() => setOpen(true)}>{t("replication.connect")}</Button>
			<AppDialog
				open={open}
				onOpenChange={setOpen}
				title={t("replication.connect")}
				description={t("replication.connectHelp")}
				footer={
					<Button
						disabled={
							connect.isPending || !input?.url || (input?.code.length ?? 0) < 32
						}
						onClick={() => {
							const current = manual ? input : parsePairingInvitation(text)
							if (current)
								connect.mutate({
									url: current.url,
									code: current.code,
									fingerprint: current.fingerprint,
								})
						}}
					>
						{t("replication.connect")}
					</Button>
				}
			>
				<div className="space-y-3">
					{!manual && (
						<>
							<Textarea
								aria-label={t("replicationUx.pasteInvitation")}
								placeholder={t("replicationUx.pasteInvitation")}
								value={text}
								onChange={(event) => setText(event.target.value)}
							/>
							{text && !parsed && (
								<p role="alert" className="text-xs">
									{t("replicationUx.invalidInvitation")}
								</p>
							)}
							{parsed && (
								<p className="break-all text-xs">
									{t("replication.url")}: {parsed.url}
								</p>
							)}
						</>
					)}
					<label className="flex items-center gap-2 text-xs">
						<input
							type="checkbox"
							checked={manual}
							onChange={(event) => setManual(event.target.checked)}
						/>
						{t("replicationUx.manualConnection")}
					</label>
					{manual && (
						<>
							<Input
								value={url}
								onChange={(event) => setUrl(event.target.value)}
								aria-label={t("replication.url")}
								placeholder={t("replication.url")}
							/>
							<Input
								value={code}
								onChange={(event) => setCode(event.target.value)}
								aria-label={t("replication.code")}
								placeholder={t("replication.code")}
								autoComplete="off"
							/>
							<Input
								value={fingerprint}
								onChange={(event) => setFingerprint(event.target.value)}
								aria-label={t("replication.fingerprint")}
								placeholder={t("replication.fingerprint")}
							/>
						</>
					)}
				</div>
			</AppDialog>
		</>
	)
}

export function PairingInviteButton({ disabled }: { disabled: boolean }) {
	const { t } = useTranslation()
	const [invitation, setInvitation] = useState<{
		code: string
		expiresAt: number
	} | null>(null)
	const [url, setUrl] = useState(
		window.location.protocol === "https:" ? window.location.origin : "",
	)
	const [fingerprint, setFingerprint] = useState("")
	const [copied, setCopied] = useState(false)
	const [copyFailed, setCopyFailed] = useState(false)
	const invite = useToastMutation({
		...trpcMutation("replication", "invitation"),
		onSuccess: async (value) => {
			setInvitation(value)
			setCopied(false)
			setCopyFailed(false)
			try {
				const info = await getDesktopBridge()?.getLanInfo()
				const address = info?.addresses[0]?.address
				if (info?.enabled && info.https && address) {
					setUrl(
						`https://${address.includes(":") ? `[${address}]` : address}:${info.lanHttpsPort}`,
					)
					setFingerprint(info.fingerprint ?? "")
				}
			} catch {
				/* The HTTPS address can also be supplied manually. */
			}
		},
	})
	const text = invitation
		? formatPairingInvitation({
				...invitation,
				url: url.trim(),
				fingerprint: fingerprint.trim() || undefined,
			})
		: undefined
	return (
		<>
			<Button
				disabled={disabled || invite.isPending}
				onClick={() => invite.mutate(undefined)}
			>
				{t("replication.invite")}
			</Button>
			<AppDialog
				open={invitation !== null}
				onOpenChange={(open) => {
					if (!open) setInvitation(null)
				}}
				title={t("replication.invite")}
				description={t("replication.inviteHelp")}
			>
				{invitation && (
					<div className="space-y-3">
						<Input
							value={url}
							onChange={(event) => {
								setUrl(event.target.value)
								setCopied(false)
							}}
							aria-label={t("replication.url")}
							placeholder={t("replication.url")}
						/>
						{!text && <p className="text-xs">{t("replication.addressHelp")}</p>}
						<Button
							disabled={!text}
							onClick={() => {
								if (!text) return
								if (!navigator.clipboard) {
									setCopyFailed(true)
									return
								}
								void navigator.clipboard
									.writeText(text)
									.then(() => {
										setCopied(true)
										setCopyFailed(false)
									})
									.catch(() => setCopyFailed(true))
							}}
						>
							{t(
								copied
									? "replicationUx.copied"
									: "replicationUx.copyInvitation",
							)}
						</Button>
						{copyFailed && (
							<p role="alert" className="text-xs">
								{t("replicationUx.copyFailed")}
							</p>
						)}
						<details open={copyFailed} className="text-xs">
							<summary className="cursor-pointer py-2">
								{t("replication.details")}
							</summary>
							<div className="space-y-2">
								<Input
									readOnly
									value={invitation.code}
									aria-label={t("replication.code")}
									onFocus={(event) => event.target.select()}
								/>
								<Input
									value={fingerprint}
									onChange={(event) => {
										setFingerprint(event.target.value)
										setCopied(false)
									}}
									aria-label={t("replication.fingerprint")}
									placeholder={t("replication.fingerprint")}
								/>
								{text && (
									<Textarea
										readOnly
										value={text}
										aria-label={t("replicationUx.invitation")}
										onFocus={(event) => event.target.select()}
									/>
								)}
							</div>
						</details>
						<p className="text-xs text-muted-foreground">
							{new Date(invitation.expiresAt).toLocaleString()}
						</p>
					</div>
				)}
			</AppDialog>
		</>
	)
}
