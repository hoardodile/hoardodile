import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/settings/app")({
	// Former App tab (renamed to Data). Keep the old path working for
	// bookmarks and deep links; the Data route's requireAuth handles the
	// unauthenticated case by sending the visitor to /login.
	beforeLoad: () => {
		throw redirect({ to: "/settings/data" })
	},
	component: () => null,
})
