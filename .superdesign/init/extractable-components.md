# Extractable components

## AppShell

- Source: `src/web/components.tsx`
- Category: layout
- Description: Sticky authenticated navigation with brand, primary routes, notifications, and account control.
- Extractable props: `activeItem`, `displayName`, `showNotification`
- Hardcoded: ResolveRoom brand glyph, route labels, icon choices, CSS classes

## Brand

- Source: `src/web/components.tsx`
- Category: basic
- Description: ResolveRoom glyph and wordmark.
- Extractable props: `compact`
- Hardcoded: exact CSS-rendered room/gate glyph and ResolveRoom label

## Dialog

- Source: `src/web/components.tsx`
- Category: basic
- Description: Accessible modal surface with title, description, close control, and body slot.
- Extractable props: `title`, `description`, `open`
- Hardcoded: close icon and dialog surface styling

## StatusBadge

- Source: `src/web/components.tsx`
- Category: basic
- Description: Compact mono status label with semantic marker.
- Extractable props: `status`
- Hardcoded: status normalization and semantic CSS variants
