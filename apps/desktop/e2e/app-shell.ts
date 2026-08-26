import { expect, type Page } from "@playwright/test"

/**
 * The claim/relaunch smoke asserts the authenticated main shell rendered.
 * The shell is responsive by design (AppShell.tsx): at or above
 * `--breakpoint-sidebar` (1150px, packages/ui/src/styles/theme.css) the
 * sidebar itself shows; below it the caption-strip drawer button
 * (`app-sidebar-open`) takes its place. CI runners vary in display width
 * (the GitHub Windows session display is 1024x768, which clamps the app's
 * 1440px window), so the sidebar alone must never be asserted — assert
 * the invariant both layouts share: the claim landed in the main shell.
 */
export async function expectShellRendered(
	appWin: Page,
	options: { readonly timeout?: number } = {},
): Promise<void> {
	await expect
		.poll(
			() =>
				appWin.getByTestId("app-sidebar").isVisible() ||
				appWin.getByTestId("app-sidebar-open").isVisible(),
			{ timeout: options.timeout ?? 15_000 },
		)
		.toBe(true)
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
