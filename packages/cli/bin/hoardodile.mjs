#!/usr/bin/env node
import { runMain } from "citty"
// Unified hoardodile CLI — see src/main.ts. The dist build is the
// published entry; the CLI itself is a thin loader.
import { main } from "../dist/main.js"

runMain(main)
