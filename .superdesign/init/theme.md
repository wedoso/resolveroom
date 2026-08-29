# Theme context

## Compact token summary

- Canvas `#f8f7f3`, raised paper `#fffefa`, muted paper `#f1f0ea`.
- Primary ink `#17211d`, secondary `#35443d`, metadata `#5f6e67`.
- Brand forest `#173f32`, hover forest `#235745`, sage `#cfe1d4`.
- Hairline `rgba(23,33,29,.14)`, strong border `rgba(23,33,29,.28)`.
- Display: Space Grotesk; UI: Inter; metadata: JetBrains Mono.
- Structural radius 0, controls 6px, dialogs 10px, badges/avatars 999px.
- Main frame 1240px, app max 1440px; mobile breakpoints 800px and 520px.
- Shadows only for dialogs: `0 16px 48px rgba(23,33,29,.14)`.

## Raw source tokens

Source: `src/web/styles.css`.

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@500;600;700&display=swap');
:root {
  font-family: Inter, system-ui, sans-serif;
  color: #17211d;
  background: #f8f7f3;
  --paper: #f8f7f3;
  --white: #fffefa;
  --muted: #f1f0ea;
  --ink: #17211d;
  --ink-2: #35443d;
  --ink-3: #5f6e67;
  --forest: #173f32;
  --forest-2: #235745;
  --sage: #cfe1d4;
  --blue: #d7e3ea;
  --gold: #f0e4b8;
  --coral: #f1d2c6;
  --danger: #9b3b32;
  --success: #28704e;
  --line: rgba(23, 33, 29, 0.14);
  --line-strong: rgba(23, 33, 29, 0.28);
  --shadow: 0 16px 48px rgba(23, 33, 29, 0.14);
}
```

The full global stylesheet is `src/web/styles.css`; relevant Agents-page blocks are lines 1–260, 600–720, 988–1045, 1205–1295, and 2127–2325.
