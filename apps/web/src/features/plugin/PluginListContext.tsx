import { useQuery } from "@tanstack/react-query"
import { createContext, type ReactNode, useContext } from "react"
import type { RouterOutputs } from "@/trpc/client"
import { pluginListAllQueryOptions } from "./pluginApi"

type PluginList = RouterOutputs["plugin"]["listAll"]

const PluginListContext = createContext<
	| {
			readonly plugins: PluginList
			readonly isPending: boolean
	  }
	| undefined
>(undefined)

export function PluginListProvider(props: { readonly children: ReactNode }) {
	const { data, isPending } = useQuery(pluginListAllQueryOptions())

	return (
		<PluginListContext.Provider value={{ plugins: data ?? [], isPending }}>
			{props.children}
		</PluginListContext.Provider>
	)
}

/**
 * Access the global plugin list. When rendered inside {@link PluginListProvider}
 * the list is fetched once and shared; otherwise it falls back to a local
 * `useQuery` so existing call sites keep working.
 */
export function usePluginList() {
	const ctx = useContext(PluginListContext)
	if (ctx !== undefined) return ctx
	const { data, isPending } = useQuery(pluginListAllQueryOptions())
	return { plugins: data ?? [], isPending }
}
