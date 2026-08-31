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
				async () =>
					// Await both sides: isVisible() returns a Promise, and a
					// bare `a || b` on promises is always the first (truthy)
					// promise — the drawer half would never be evaluated.
					(await appWin.getByTestId("app-sidebar").isVisible()) ||
					(await appWin.getByTestId("app-sidebar-open").isVisible()),
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
 * Reveal the shell's sidebar content the way a user would, regardless of the
 * viewport: the sidebar itself at/above the sidebar breakpoint, the drawer
 * below it. The GitHub Windows runner clamps the app window below that
 * breakpoint, so the sidebar (and everything in it — the update banner, the
 * Settings rows, nav links) sits in a `display:none` container until the
 * drawer is opened. Every sidebar-only assertion must go through this so a
 * clamped CI viewport doesn't read a present-but-hidden element.
 */
export async function openShellContent(appWin: Page): Promise<void> {
	if (!(await appWin.getByTestId("app-sidebar").isVisible())) {
		await appWin.getByTestId("app-sidebar-open").click()
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
	await openShellContent(appWin)
	await appWin.getByRole("link", { name: linkName }).click()
}
