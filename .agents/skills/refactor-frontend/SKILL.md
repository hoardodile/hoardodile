---
name: refactor-frontend
description: Refactor one specific frontend module or feature — never the whole project. Use when the user asks to refactor, clean up, restructure, or simplify a specific React/Vue component, hook, page, or UI module.
---

Run the `/refactor-module` skill first — its principles remain in effect. This skill adds frontend-specific rules on top.

**Core principle**: keep the rendering layer and the logic layer pure, and decouple them progressively as complexity grows. Every abstraction serves the same purpose — separating complexity to keep code maintainable and readable — they just differ in how: Hooks achieve it through reuse, Context through sharing.

1. Rendering layer: Simple, intuitive state stays inside the component — no extra abstraction needed.

2. Custom Hooks: When business rules are no longer intuitive, extract them into reusable Hooks. This solves **logic reuse** — the logic is shared, while each usage keeps its own private state. In other words, "everyone gets their own copy."

3. Custom Context: When rules span multiple cohesive components, or prop drilling devolves into "passing just for the sake of passing," lift the state into Context. This solves **state sharing** — scoping state to a defined boundary, i.e., "everyone shares the same copy."

4. Framework-agnostic layer: When logic is independent of the framework (e.g., complex canvas operations, platform-independent algorithms), isolate it into a pure module, with Hooks/Context acting merely as adapters.

Beyond that, when a component's logic becomes tangled and hard to follow, it's also worth proactively lifting it up a level — in this case the abstraction has nothing to do with reuse or sharing; its purpose is simply to reduce cognitive load.
