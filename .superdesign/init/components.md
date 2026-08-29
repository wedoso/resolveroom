# Shared UI components

Source: `src/web/components.tsx`

## Brand

ResolveRoom wordmark and room/gate glyph.

```tsx
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="brand" aria-label="ResolveRoom home">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <b />
      </span>
      {!compact && <span>ResolveRoom</span>}
    </Link>
  );
}
```

## StatusBadge

Compact status marker used across records.

```tsx
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status}`}>
      <i />
      {status.replaceAll('_', ' ')}
    </span>
  );
}
```

## Dialog

Accessible native dialog wrapper used for create, credential, and confirmation flows.

```tsx
export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog-card">
        <button className="icon-button dialog-close" aria-label="Close dialog" onClick={onClose}>
          <X />
        </button>
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
        <div className="dialog-body">{children}</div>
      </div>
    </dialog>
  );
}
```
