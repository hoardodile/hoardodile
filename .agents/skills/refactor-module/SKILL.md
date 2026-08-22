---
name: refactor-module
description: Refactor one specific module or feature named by the user — never the whole project. Use when the user asks to refactor, clean up, restructure, or simplify a specific module, feature, file, or directory.
---

Refactor only the module or feature the user named.

Apply these principles, in whatever order the code demands:

- Deduplicate code. Collapse functions with more than 4 parameters into a single params/options object, unless the parameter list is clearly justified.
- Break down long functions and deep call chains. Extract a file only for a distinct, standalone responsibility — keep file-level cohesion high, do not split just to reduce line count.
- Enforce SOLID principles — but avoid over-engineering: no speculative abstractions, no generality the current code does not need.
- Favor composition over inheritance. Keep cohesion high and coupling low. Depend on abstractions, not concrete implementations (DIP).
- Sharpen naming so every name says exactly what the thing is and does. Extract pure functions where logic mixes computation with side effects.

If a needed change ripples outside the named scope (e.g. a public interface change), stop and confirm with the user before proceeding.
