# SMS V1.2 — VF071 Visual Reconciliation

## Authority and evidence

Authoritative visual reference (read-only):
`C:\Users\sermp\OneDrive - PTTPLC\04_SSO\ปี-2569\40.AI\SMS_V3_G04_2_VF071_OWNER_BRAND_FIX_VISUAL_EVIDENCE`

Reviewed evidence includes the VF071 owner-brand contact sheet plus Light/Dark Login, Dashboard, Personnel, Access, Registration Review and mobile captures. V1.1 is treated as the interaction/typography/performance baseline, not the visual authority.

Pixel sampling of the actual VF071 images confirms the intended balance: Login Light is a very bright pastel field (sampled average approximately RGB 240/236/245), Dashboard Light approximately 245/245/248, while Dashboard/Personnel Dark remain midnight surfaces around RGB 28/34/50 and 25/31/49 rather than near-black.

## Reconciliation matrix

| Screen / system | VF071 visual strength | Signature V1.1 strength | V1.2 target |
| --- | --- | --- | --- |
| Login Light | Bright lavender/blush atmosphere, welcoming split composition, readable dark hero copy | Modern Noto Sans Thai/Inter, accepted shield geometry, responsive auth flows | Restore VF071 pastel Light shell and hero contrast; retain current typography, shield, auth flows, Theme control and mobile behavior |
| Login Dark | Aurora midnight with colorful but restrained violet/cyan depth | Strong dark readability and modern form hierarchy | VF071 atmosphere with V1.1 semantic text tokens and Passkey secondary action |
| Dashboard | Airier background and softer visual separation | Command Center hierarchy, compact mobile metrics, bounded data architecture | Reduce box heaviness while preserving Action Required priority and compact mobile composition |
| Personnel | Cleaner surrounding atmosphere | Row-to-detail drawer, visible Edit, mobile cards/sheet, modern typography | Keep V1.1 task flow; restore air/soft separation and align action column structurally |
| Licenses | Calm table surroundings | Current document workflow, visible common action, secondary overflow | Keep workflow; use the same shared action-column geometry as Personnel |
| Schedule | Balanced VF071 dark atmosphere | V1.1 high-contrast employee identity and corrected dark controls | Preserve readability/control fixes; lighten surrounding dark hierarchy without reverting table semantics |
| Leave | Less visually heavy page treatment | Decision workspace and 2-click operations | Preserve workspace; use V1.2 shared dark/light surface balance |
| Access | Softer navigation/data hierarchy | Visible frequent role/status actions and detail architecture | Preserve action accessibility while returning VF071 visual restraint |
| Audit | Cleaner page atmosphere | Dark KPI and ghost detail controls | Keep V1.1 control fixes; use V1.2 semantic dark typography globally |
| Reports / Data Quality | VF071 visual system expects legible semantic typography | V1.1 page architecture | Close legacy Light-only navy text leakage on Dark at the token/route level |
| Light Mode | Pastel Airy Colorful Premium | Better typography and density | VF071 palette and air with V1.1 typography/interaction |
| Dark Mode | Aurora Midnight Colorful Glow Enterprise | Strong table consistency/readability | Slightly brighter layered midnight surfaces, readable near-white/slate text, violet as accent only |
| Mobile | Clean compact brand language | Deliberately designed mobile Dashboard, Personnel cards and full-height detail | Preserve V1.1 mobile UX exactly; only reconcile atmosphere/typography colors |

## What V1.2 deliberately does not restore

- Legacy typography or IBM Plex Sans Thai as the product UI font.
- Extra clicks, eye-icon inspection patterns, modal chains, or hidden frequent actions.
- Compressed desktop layouts on mobile.
- Sequential Dashboard query execution.
- White Dark-mode table rows or weak Schedule contrast.
- Page-specific visual fixes that bypass shared semantic tokens.

## V1.2 implementation authority

A late `signature-experience-v1-2.css` layer restores VF071 visual character without reverting old application source. It is intentionally loaded after V1.1 and owns:

1. VF071-derived Light Login pastel gradients and readable hero copy.
2. Balanced Aurora Midnight Dark surfaces with V1.1 semantic text contrast.
3. Global Dark route heading/body/helper contracts for Reports, Executive Report, Data Quality, Audit and major operational pages.
4. Shared action-column geometry for Personnel and License/operational tables.
5. Passkey login and account-security presentation.

The V1.1 Noto Sans Thai + Inter + IBM Plex Mono stack, drawers/sheets/workspaces, compact mobile Dashboard, loading/empty/error states, 2-click architecture, and Dashboard query concurrency limit of 4 remain authoritative.
