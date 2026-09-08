import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
	root: import.meta.dirname,
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: { "@": resolve(import.meta.dirname, "../../src") },
		dedupe: ["react", "react-dom"],
	},
	server: { host: "127.0.0.1", port: 4327, strictPort: true, cors: true },
})
