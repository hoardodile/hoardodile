import "./index.css"

import { createPluginRoot } from "@hoardodile/sdk-react"
import { PluginAPIProvider } from "./hooks"
import { TemplateView } from "./TemplateView"

createPluginRoot({ provider: PluginAPIProvider, render: TemplateView })
