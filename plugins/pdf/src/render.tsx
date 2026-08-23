import "./index.css"

import { createPluginRoot } from "@hoardodile/sdk-react"
import { PluginAPIProvider } from "./hooks"
import { PdfViewer } from "./PdfViewer"

createPluginRoot({ provider: PluginAPIProvider, render: PdfViewer })
