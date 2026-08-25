#!/usr/bin/env node
/**
 * Print the newest `## <version>` section of CHANGELOG.md to stdout — the
 * body for the GitHub Release draft (see scripts/ensure-release-draft.mjs).
 *
 *   node scripts/latest-release-notes.mjs
 */

import { latestReleaseNotes } from "./lib/changelog.mjs"

console.log(latestReleaseNotes())
