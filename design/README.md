# Design source (Claude Design handoff)

`tire-inspection-mobile-app-design/project/TireReport.dc.html` is the visual
source of truth for this product; `support.js` is the prototype runtime it
imports. `uploads/` holds the reference material (the 2019 TireReport app and
photos) the design was derived from.

Sections inside the design file:

- **1a** Driver flow (412×872 phone): phone lookup → equipment/odometer →
  20-tire diagram → review & submit, plus the keypad bottom sheet.
- **1b** Admin console (1280×872): navy sidebar, KPI cards, data tables.
- **1c** Design system: tokens, type, geometry, tire-card anatomy.

Rule of precedence (from Ion): the design defines how the product looks; the
functional spec defines how it works. Where the prototype's demo thresholds
differ from the spec (PSI 98–120, dual Δ ≤ 4), the spec's thresholds apply
and the design's visual treatment is kept.

Tokens are implemented in `src/app/globals.css`; the tire card in
`src/components/tire/TireNode.tsx`; axle rows in `AxleRow.tsx`.
