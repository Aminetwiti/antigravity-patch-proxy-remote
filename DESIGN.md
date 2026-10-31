---
name: Antigravity Custom Model Enabler UI
description: A calm, native-feeling dark control surface injected into the Antigravity IDE settings to manage external AI models.
colors:
  surface-base: "#18181b"
  surface-raised: "#1c1c1f"
  surface-input: "#27272a"
  border-subtle: "#27272a"
  border-strong: "#3f3f46"
  border-stronger: "#3f3f46"
  ink-primary: "#f4f4f5"
  ink-secondary: "#a1a1aa"
  ink-muted: "#71717a"
  accent-blue: "#3b82f6"
  accent-blue-deep: "#2563eb"
  positive: "#22c55e"
  warning: "#eab308"
  danger: "#ef4444"
  danger-deep: "#dc2626"
  provider-openai: "#10a37f"
  provider-anthropic: "#d97757"
  provider-google: "#4285f4"
  provider-ollama: "#f0f0f0"
  provider-openrouter: "#ff7a45"
  provider-custom: "#a855f7"
typography:
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.3
  heading:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.2
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.5px"
    textTransform: "uppercase"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.accent-blue-deep}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  chip-provider:
    backgroundColor: "{colors.provider-custom}22"
    textColor: "{colors.provider-custom}"
    rounded: "{rounded.sm}"
    padding: "2px 6px"
    typography: "{typography.label}"
  card-model:
    backgroundColor: "{colors.surface-base}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
  input-field:
    backgroundColor: "{colors.surface-input}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
---

# Design System: Antigravity Custom Model Enabler UI

## 1. Overview

**Creative North Star: "The Quiet Console"**

The injected Custom Models UI is a calm, native-feeling control surface that disappears into the Antigravity IDE chrome. It does not announce itself; it behaves like a panel the IDE always had. The aesthetic is restrained dark zinc, system typography, and provider-colored accents used sparingly to signal identity rather than decoration. Every state — empty, loading, error, success — is built to reassure: the user always knows what the system is doing and what to do next.

This system explicitly rejects loud "AI wrapper" dashboards, gradient-heavy neon UIs, generic SaaS card grids, and any visual language that clashes with the dark, restrained Antigravity shell. No cream or sand backgrounds, no playful mascots, no error states that blame the user.

**Key Characteristics:**
- Dark, tonal surfaces (zinc 900–800 range) that match the host IDE.
- System font stack; no display or decorative typefaces.
- Provider accents appear only as small icon bubbles, badges, and status dots — never as large fills.
- Motion is minimal and purposeful: a soft modal scale-in, a toast fade, a status-dot color shift.
- Feedback is constant but quiet: connection tests, status dots, and contextual toasts.

## 2. Colors: The Quiet Zinc Palette

A near-monochrome dark neutral ramp carries the interface; provider brand colors and semantic status hues are the only chromatic notes, used at small scale.

### Primary
- **Accent Blue** (#3b82f6): Primary action color — the "Fetch Models" / "Add Selected Models" buttons, active step indicator, modality badges. Deepens to #2563eb on hover. Used sparingly (≤10% of any surface).

### Secondary
- **Provider Custom Purple** (#a855f7): Default identity for unknown/custom providers and the error-toast accent line.

### Neutral
- **Surface Base** (#18181b): Default panel, modal, and card background.
- **Surface Raised** (#1c1c1f): Slightly lifted areas — the modal form container, suggestion boxes.
- **Surface Input** (#27272a): Inputs, model-select cards, and the banner container fill.
- **Border Subtle** (#27272a): Hairline dividers and resting card borders.
- **Border Strong** (#3f3f46): Modal frame, input borders on focus, hover border on cards.
- **Ink Primary** (#f4f4f5): Body and title text. Contrast vs #18181b ≈ 14:1.
- **Ink Secondary** (#a1a1aa): Subtitles, placeholders, inactive controls. Contrast vs #18181b ≈ 6.5:1.
- **Ink Muted** (#71717a): Model IDs, helper text, close glyphs. Contrast vs #18181b ≈ 4.0:1 — used only for non-essential metadata, never body copy.

### Semantic
- **Positive** (#22c55e): Success status dot, connected state, selected model card border.
- **Warning** (#eab308): Rate-limit / quota toasts, model-selector warning glyph.
- **Danger** (#ef4444): Error toasts, failed connection, delete-hover. Deepens to #dc2626 on hover.

### Provider Accents
- **OpenAI** (#10a37f), **Anthropic** (#d97757), **Google** (#4285f4), **Ollama** (#f0f0f0), **OpenRouter** (#ff7a45), **Custom** (#a855f7). Each used as a low-opacity tint (`+22`/``+18`` hex alpha) behind an icon bubble or badge, with the full color as the glyph.

### Named Rules
**The One Voice Rule.** The accent blue fills ≤10% of any surface. Provider colors appear only as 16–32px icon bubbles, 10px badges, or 6px status dots — never as panels or backgrounds.

## 3. Typography

**Display Font:** System UI (-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)
**Body Font:** Same system stack
**Label/Mono Font:** Same system stack (no separate mono; provider badges use uppercase system text)

**Character:** A single, neutral system voice — invisible by design, so the injected UI reads as part of the IDE rather than a third-party add-on. Weight and size carry hierarchy, not typeface contrast.

### Hierarchy
- **Heading** (600, 18px, 1.2): Modal titles ("Provider Manager").
- **Title** (500, 14px, 1.3): Model names, section headings ("Custom Models").
- **Body** (400, 13px, 1.4): Descriptions, list subtitles, toast copy. Line length capped by container width, not a ch rule.
- **Label** (600, 10px, 0.5px tracking, uppercase): Provider badges, "Suggested Actions" captions.

### Named Rules
**The Invisible Type Rule.** Never introduce a non-system font. Hierarchy comes from weight (500/600) and size (10/13/14/18px) only.

## 4. Elevation

This system is flat at rest and uses tonal layering for depth: surfaces step from #18181b → #1c1c1f → #27272a. Shadows appear only on elevated, transient layers — the modal and the toast — where they separate an overlay from the IDE behind it.

### Shadow Vocabulary
- **Modal Lift** (`box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5)`): The Provider Manager modal.
- **Toast Lift** (`box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5), 0 4px 6px -2px rgba(0,0,0,0.5)`): Error/status toasts.
- **Banner Lift** (`box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1)`): Persistent error banner above the chat input.

### Named Rules
**The Flat-By-Default Rule.** Inline panels and cards are flat (border + tonal fill only). Shadows are reserved for overlays that float above the IDE.

## 5. Components

### Buttons
- **Shape:** Radius 4px (sm).
- **Primary:** Accent blue fill, white label text, 6px 12px padding, uppercase 10px/600 label style for modal CTAs. Hover → #2563eb.
- **Ghost / Icon:** Transparent background, #a1a1aa glyph, 6px padding, 4px radius. Hover tints the glyph with its semantic color (green for test, red for delete) at 10% alpha.
- **Secondary (IDE-matched):** The "Provider Manager" entry button clones the IDE's own Refresh button classes/styles so it reads as native.

### Chips
- **Provider Badge:** 10px uppercase label, 2px 6px padding, 4px radius, provider color at 13% alpha bg + full provider color text.
- **Modality Badge:** Accent blue fill, white 10px text, 4px radius — marks vision/audio models.

### Cards / Containers
- **Model Row Card:** #18181b bg, 1px #27272a border, 8px radius, 12px 16px padding. Hover → border #3f3f46, bg #1c1c1f.
- **Model Select Card (modal):** #27272a bg, 2px #3f3f46 border, 8px radius, 12px padding. Selected → border #22c55e, bg #22c55e18.
- **Empty State:** Centered column, 24px padding, #18181b bg, 1px #27272a border, 8px radius.

### Inputs / Fields
- **Style:** #27272a bg, 1px #3f3f46 border, 4px radius, 8px 12px padding, #f4f4f5 text.
- **Focus:** Border shifts to #3f3f46 (already strong at rest) with the field sitting on the raised #1c1c1f form container; error text appears in #ef4444 below the field.
- **Error:** Inline message in danger red; field border holds.

### Signature Component — Status Dot
A 6px circle on each model row. Neutral gray (#71717a) = untested; green (#22c55e) = connected; red (#ef4444) = failed. Transitions background-color over 0.3s. It is the quietest possible signal that the system is alive.

### Signature Component — Provider Manager Modal
A 650px-wide, max-85vh modal with a two-step flow: Step 1 (enter provider URL/key, fetch models) → Step 2 (pick models, optional display-name suffix, save). A 2-step indicator tracks progress; the active step circle turns accent blue. Animate in with `scale(0.9) translateY(20px)` → `scale(1) translateY(0)` over ~200ms; respect `prefers-reduced-motion` by jumping to final state.

### Navigation
Not a persistent nav — the modal closes to the IDE. The only "navigation" is the step indicator inside the modal and the Refresh-button clone that re-syncs the model list.

## 6. Do's and Don'ts

### Do:
- **Do** match the IDE's dark zinc surfaces (#18181b / #1c1c1f / #27272a) for any new panel or modal.
- **Do** use provider accent colors only as small icon bubbles, badges, or status dots.
- **Do** keep body text at #f4f4f5 / #a1a1aa on dark surfaces to hold ≥4.5:1 contrast.
- **Do** show a quiet status dot (gray → green/red) so the user always knows connection state.
- **Do** clone the IDE's own button classes for entry points so they read as native.
- **Do** honor `prefers-reduced-motion`: modals and toasts appear at final state, no transform/opacity animation.

### Don't:
- **Don't** use cream, sand, beige, or any warm-neutral body background — the surface stays in the cool zinc-dark band.
- **Don't** introduce gradient-heavy, neon, or glassmorphism visuals that clash with the restrained IDE shell.
- **Don't** build loud "AI wrapper" dashboards that shout for attention or use playful mascots.
- **Don't** use a non-system font; hierarchy is weight/size only.
- **Don't** fill large areas with provider brand colors; the One Voice Rule caps accent fills at ≤10% of a surface.
- **Don't** write error states that blame the user — say what failed and the exact next action (Configure API Key, Retry, Manage Billing).
