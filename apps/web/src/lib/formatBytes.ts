/**
 * Format a non-negative byte count as a short human-readable string
 * (binary, JEDEC labels — `4.5 KB`, `1.2 MB`). Canonical implementation
 * lives in `@hoardodile/ui` so the res-card template renderer (which its
 * `bytes(...)` pipe needs) shares it verbatim.
 */
export { formatBytes } from "@hoardodile/ui/res-card-template"
