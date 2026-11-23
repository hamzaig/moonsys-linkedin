# Workspace-specific rules

These rules extend `../MASTER.md`.

## Dashboard and analytics

Use `MetricCard` for KPIs and the colors from `lib/ui/brand.ts` for matching series across dashboard and campaign analytics. Preserve the API's metric definitions and calculations. Expose chart values through `ChartDataTable`. Start with two metric columns on mobile and expand at larger breakpoints.

## CRM detail views

Contact profile/activity and contextual panels stack below the desktop breakpoint. Wrap external/contact actions, allow long names to wrap, and keep email addresses usable without forcing the page wider than the viewport. Company detail fields collapse to one column on narrow screens.

## Campaign workspace

Keep the existing builder, track logic, delays and run actions. The pipeline is a separate scrollable pane on desktop and a bounded section above the prospects table on mobile. Campaign analytics use a single column until sufficient space is available for the funnel alongside the activity chart.

## Dialer and script editor

Use `ms-split-workspace` and `ms-split-sidebar` to fill the available area below the topbar. On mobile, the queue/script list appears above the detail/editor pane. Use the compact shared page header here; preserve character art and call interactions.

## Access and settings

Login/signup uses the brand story beside the form on wide screens and a compact original wordmark above the form on mobile. Preserve the invite-code and credential flow. Settings tabs scroll horizontally as a group; do not hide tabs or change capability checks to fit a narrow screen.
