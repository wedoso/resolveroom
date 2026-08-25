# Page dependency trees

## `/agents`

- `src/web/pages.tsx` (`AgentsPage`, lines 656–809)
  - `src/web/components.tsx` (`AppShell`, `PageLoading`, `StatePanel`, `StatusBadge`, `Dialog`)
  - `src/web/api.ts`
  - `src/web/styles.css`

## `/dashboard`

- `src/web/pages.tsx` (`DashboardPage`)
  - `src/web/components.tsx`
  - `src/web/api.ts`
  - `src/web/styles.css`

## `/conflicts/:id`

- `src/web/conflict-room.tsx`
  - `src/web/components.tsx`
  - `src/web/api.ts`
  - `src/web/styles.css`

## `/`, `/signin`, `/conflicts/new`, `/join/:token`, `/notifications`, `/share/:token`

- `src/web/pages.tsx`
  - `src/web/components.tsx`
  - `src/web/api.ts`
  - `src/web/styles.css`

All routes are composed by `src/web/app.tsx` and mounted from `src/web/main.tsx`.
