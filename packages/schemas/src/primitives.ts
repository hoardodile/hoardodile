import { z } from "zod"

/**
 * Opaque entity id. All domain entities (resources, characters, tags, ...)
 * share this shape; we do not encode type information in the id itself
 * since callers already know the entity kind from context.
 */
export const id = z.string().min(1)

/**
 * Unix milliseconds since epoch, non-negative integer. Used for
 * `createdAt` / `updatedAt` / `deletedAt` across all domain schemas.
 */
export const timestamp = z.number().int().nonnegative()
