# Product

## Register

product

## Platform

web

## Users

Developers working inside the Antigravity IDE who want to use AI models beyond the built-in Gemini family (OpenAI, Anthropic, Together, Ollama, Google AI Studio, and any OpenAI-compatible provider). They are technically fluent, comfortable with API keys and endpoints, and expect the model picker to behave exactly like the native one. A secondary audience is technical enthusiasts experimenting with self-hosted or niche LLM providers.

## Product Purpose

This is a patch for Google Antigravity that unlocks external AI models. It injects a local HTTP proxy into the Electron app, reverse-engineers the Cloud Code internal API, translates request/response formats between providers, and surfaces an inline "Custom Models" experience in the Settings → Models area plus a "Provider Manager" modal. Success means a developer can add, test, and use a non-Gemini model without leaving the IDE or feeling a seam between native and custom models.

## Positioning

One IDE, every model: bring any OpenAI-compatible provider into Antigravity and use it like a first-class Gemini model.

## Brand Personality

Calm, guided, reassuring. The injected UI should feel like a quiet, confident extension of the host IDE — never louder than the surrounding chrome, never alarming about errors, always showing the user exactly what to do next. Voice is plain and helpful, not marketing-flavored.

## Anti-references

- Loud, gradient-heavy "AI wrapper" dashboards that shout for attention.
- Generic SaaS settings pages with disconnected card grids and no hierarchy.
- Error states that blame the user or bury the fix.
- Visual languages that clash with the dark, restrained Antigravity/VS Code-adjacent shell (no cream/sand/beige, no neon, no playful mascots).

## Design Principles

- **Blend, don't shout.** Match the host IDE's dark surface, type, and spacing so the injected UI reads as native.
- **Guide the next step.** Every state — empty, loading, error, success — makes the immediate action obvious.
- **Earn trust through feedback.** Connection tests, status dots, and contextual toasts prove the system is working and say why when it isn't.
- **Respect the surrounding chrome.** Reuse the IDE's own classes and tokens where possible rather than inventing a parallel system.

## Accessibility & Inclusion

Targets WCAG 2.1 AA. The injected UI inherits a dark theme, so text must hold ≥4.5:1 contrast against its surface (body text near `#f4f4f5` on `#18181b` is the baseline). Interactive controls need visible focus and hover states. Honor `prefers-reduced-motion` for the modal/toast animations already present in the code.
