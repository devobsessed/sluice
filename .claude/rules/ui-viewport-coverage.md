---
paths:
  - "src/components/**/*.{ts,tsx}"
  - "src/app/**/*.tsx"
---
# All UI Changes Verify Every Viewport

Any UI change MUST be specified, implemented, and verified at all three reference viewports before it ships: mobile 375px, tablet 768px, desktop 1280px+ (quality.yaml breakpoints sm/md/lg/xl govern intermediate behavior). Interactive elements MUST meet a 44px minimum touch target on mobile. Walkthroughs and visual evaluations for UI stories MUST run at all three viewports, never desktop-only.

## Bad

A new pill badge designed and verified at 1440px only; on a 375px phone it falls below 44px touch size inside a horizontally scrolling strip and is untappable.

## Good

Story acceptance criteria name all three viewports per element; the implementer verifies each; the walkthrough screenshots 375/768/1280; touch targets measured >= 44px on mobile.

Source: Darin directive 2026-06-12. Cycle 44 verified desktop-first; Darin found a mobile-visible header overlap and the gap was systemic, not incidental. This was missing from project setup - it is now permanent.
