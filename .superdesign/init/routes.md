# Route map

Framework: React 19 + React Router 7 + Vite.

| Route            | Entry                                             | Layout              |
| ---------------- | ------------------------------------------------- | ------------------- |
| `/`              | `LandingPage` in `src/web/pages.tsx`              | public marketing    |
| `/signin`        | `SignInPage` in `src/web/pages.tsx`               | public auth         |
| `/dashboard`     | `DashboardPage` in `src/web/pages.tsx`            | `AppShell`, private |
| `/conflicts/new` | `NewConflictPage` in `src/web/pages.tsx`          | `AppShell`, private |
| `/conflicts/:id` | `ConflictRoomPage` in `src/web/conflict-room.tsx` | `AppShell`, private |
| `/join/:token`   | `JoinPage` in `src/web/pages.tsx`                 | public invitation   |
| `/agents`        | `AgentsPage` in `src/web/pages.tsx`               | `AppShell`, private |
| `/notifications` | `NotificationsPage` in `src/web/pages.tsx`        | `AppShell`, private |
| `/share/:token`  | `SharePage` in `src/web/pages.tsx`                | public observer     |
| `*`              | `NotFoundPage` in `src/web/pages.tsx`             | public state        |

The complete router implementation is `src/web/app.tsx`.
