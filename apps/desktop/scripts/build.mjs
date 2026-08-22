import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "vite"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

await build({ configFile: resolve(root, "vite.main.config.ts") })
await build({ configFile: resolve(root, "vite.preload.config.ts") })
await build({ configFile: resolve(root, "vite.wizard.config.ts") })
