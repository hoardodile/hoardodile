import { expect, type Page } from "@playwright/test"

/**
 * The claim/relaunch smoke asserts the authenticated main shell rendered.
 * The shell is responsive by design (AppShell.tsx): at or above
 * `--breakpoint-sidebar` (1150px, packages/ui/src/styles/theme.css) the
 * sidebar itself shows; below it the caption-strip drawer button
 * (`app-sidebar-open`) takes its place. CI runners vary in display width
 * (the GitHub Windows session display clamps the app's 1440px window),
 * so the sidebar alone must never be asserted — assert the invariant
 * both layouts share: the claim landed in the main shell. On failure the
 * rethrown error carries the live viewport and element state, so a
 * runner-shaped problem is diagnosable from the failure output alone.
 */
export async function expectShellRendered(
	appWin: Page,
	options: { readonly timeout?: number } = {},
): Promise<void> {
	const timeout = options.timeout ?? 15_000
	try {
		await expect
			.poll(
				() =>
					appWin.getByTestId("app-sidebar").isVisible() ||
					appWin.getByTestId("app-sidebar-open").isVisible(),
				{ timeout },
			)
			.toBe(true)
	} catch (error) {
		const state = await appWin.evaluate(() => ({
			url: location.href,
			width: window.innerWidth,
			height: window.innerHeight,
			devicePixelRatio: window.devicePixelRatio,
			sidebarClass:
				document.querySelector('[data-testid="app-sidebar"]')?.className ??
				null,
			openButton:
				document.querySelector('[data-testid="app-sidebar-open"]') !== null,
		}))
		throw new Error(
			`main shell not rendered within ${timeout}ms (${JSON.stringify(state)})`,
			{ cause: error },
		)
	}
}

/**
 * Navigate through the sidebar the way a user would: nav rows live in the
 * sidebar, or in the drawer when the viewport is below the breakpoint —
 * a browser-tab `goto` would hit the shell's window-navigation policy.
 */
export async function navigateInShell(
	appWin: Page,
	linkName: string,
): Promise<void> {
	if (!(await appWin.getByTestId("app-sidebar").isVisible())) {
		await appWin.getByTestId("app-sidebar-open").click()
	}
	await appWin.getByRole("link", { name: linkName }).click()
}
