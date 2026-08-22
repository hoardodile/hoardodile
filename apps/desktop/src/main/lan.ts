import { type NetworkInterfaceInfo, networkInterfaces } from "node:os"

export type LanAddress = {
	readonly interfaceName: string
	readonly address: string
}

type LanInterfaceEntry = readonly Pick<
	NetworkInterfaceInfo,
	"address" | "family" | "internal"
>[]

/**
 * Non-loopback IPv4 addresses of this machine. Link-local (169.254.*)
 * addresses are excluded — they are only valid within the same subnet
 * and almost always unreachable from a phone. Private ranges sort first
 * (192.168.*, then 10.*, then 172.16-31.*) so the QR code targets the
 * address a phone on the same Wi-Fi is most likely to reach; VPN and
 * virtual adapters stay in the list but rank last.
 */
export function computeLanAddresses(
	interfaces: Record<
		string,
		LanInterfaceEntry | undefined
	> = networkInterfaces(),
): LanAddress[] {
	const addresses: LanAddress[] = []
	for (const [interfaceName, entries] of Object.entries(interfaces)) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue
			if (isLinkLocal(entry.address)) continue
			addresses.push({ interfaceName, address: entry.address })
		}
	}
	addresses.sort(
		(a, b) => privateScopeRank(a.address) - privateScopeRank(b.address),
	)
	return addresses
}

function isLinkLocal(address: string): boolean {
	return address.startsWith("169.254.")
}

/**
 * The URL other devices should open, or `undefined` when sharing is off
 * or there is no reachable address.
 */
export function lanUrlFor(
	enabled: boolean,
	port: number,
	addresses: readonly LanAddress[],
): string | undefined {
	if (!enabled) return undefined
	const primary = addresses[0]
	if (primary === undefined) return undefined
	return `http://${primary.address}:${port}/`
}

function privateScopeRank(address: string): number {
	if (address.startsWith("192.168.")) return 0
	if (address.startsWith("10.")) return 1
	const parts = address.split(".")
	if (parts.length === 4 && parts[0] === "172") {
		const second = Number(parts[1])
		if (second >= 16 && second <= 31) return 2
	}
	return 3
}
