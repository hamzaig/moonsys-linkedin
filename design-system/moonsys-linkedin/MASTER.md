# MoonSys LinkedIn design system

Reference: [MoonSys.co](https://www.moonsys.co/), verified 23 November 2026.
Implemented with the UI/UX Pro Max skill's Data-Dense Dashboard guidance and the existing Next.js Pages Router, Tailwind 4 and DaisyUI 5 stack.

## Brand

Use the original MoonSys wordmark and mark in `public/brand/`. Asset origins and font licenses are recorded in `public/brand/SOURCE.md`. Do not redraw the logo or substitute another product's identity.

| Role | Value | Use |
| --- | --- | --- |
| Navy | `#0A2540` | Text, focus, navigation, secondary strong actions |
| Pink | `#F8ABBD` | Main actions and brand emphasis, with navy text |
| Canvas | `#F7F9FC` | Application background |
| Surface | `#FFFFFF` | Cards, forms, tables, navigation |
| Border | `#DFE5ED` | Surface boundaries |
| Muted text | `#52687B` | Supporting text and labels |
| Heading/UI font | Inter | Locally hosted, variable weight |
| Body font | Mulish | Locally hosted, variable weight |

The navy/pink pairing has 8.55:1 contrast. Muted text on white has 5.79:1 contrast. White text on pink is insufficient for normal text, so use navy on pink. Semantic statuses use readable green, amber, red and blue; labels accompany their colors. Chart colors are centralized in `lib/ui/brand.ts`.

## Structure

- `styles/tokens.css`: colors, fonts, spacing and surface tokens.
- `styles/globals.css`: the MoonSys DaisyUI theme, shell, shared components, tours and responsive rules.
- `lib/ui/brand.ts`: identity, assets and chart palette.
- `lib/ui/navigation.ts`: grouped navigation, route matching and breadcrumb context.
- `components/brand/`: original logo presentation.
- `components/layout/`: responsive sidebar, mobile dialog, topbar and page shell.
- `components/ui/`: shared PageHeader, PageTitle, PageDescription, Panel, MetricCard, EmptyState and ChartDataTable, alongside existing form controls.

Use shared components for new screens. Give each page one primary heading and keep actions beside the heading when space allows. Retain the existing URLs and capability gates.

## Layout and interaction

- Desktop navigation: Workspace, CRM, Operations and Calling; account actions in the footer.
- Below 1024px: native modal navigation drawer with Escape, focus containment and focus restoration.
- Page padding: 32px on large screens, 24px below 1200px, 20px below 768px.
- White cards with 12–16px radii, restrained borders/shadows and an 8px spacing rhythm.
- Use wrapping toolbars and responsive metric grids. Wide data tables scroll within their container.
- Contact details and campaign pipelines stack on smaller screens. Dialer queue/editor panes stack below 768px.
- Keep visible keyboard focus, accessible control names, loading/disabled states and reduced-motion behavior.
- Charts expose a table view so values are available without hover or color recognition.
- Keep business actions explicit. Navigation and design changes must not send outreach, modify schedules or change data.

## Screen coverage

| Screen | Route | Application |
| --- | --- | --- |
| Dashboard | `/` | Shared metrics/panels, responsive grids, chart data view |
| Login/signup | `/login` | Original wordmark, split brand story, labeled access forms |
| Lead lists | `/lists` | Shared header, action hierarchy, empty state, table |
| List detail | `/lists/[id]` | Detail header, import/actions and table styling |
| Contacts | `/contacts` | Filters, empty state, selection and table styling |
| Contact detail | `/contacts/[id]` | Responsive profile/activity columns and actions |
| Companies | `/companies` | Directory header, search, empty state and table |
| Company detail | `/companies/[id]` | Profile header, responsive details and linked contacts |
| Campaigns | `/workflows` | Campaign cards, status styling, create/archive views |
| Campaign detail | `/workflows/[id]` | Responsive pipeline, builder styling, shared analytics metrics/colors/data view |
| Inbox | `/inbox` | Reply toolbar, classifications, message/reply styling |
| Email health | `/email-health` | Shared summary metrics, account table and responsive diagnostic panels |
| Settings | `/settings` | Scrollable tabs, shared form/status styling |
| Call queue | `/dialer` | Responsive split workspace and compact header |
| Call scripts | `/dialer/scripts` | Matching editor/sidebar layout |
| Call analytics | `/dialer/analytics` | Shared metrics and accessible activity data |
| Dialer settings | `/dialer/settings` | Shared header, visible character selection state |

Existing character artwork and third-party provider identities keep their own illustrative colors. These are not replacements for the application palette.

## Validation

Use TypeScript, the existing scheduler regression tests, an isolated production build with an empty fixture database, and lint comparison against the pre-branding source. Check the original backend/authentication file hashes and the live campaign state read-only. UI browser automation is excluded under the owner's current preference; code-level and HTTP checks do not establish a visual browser review.
