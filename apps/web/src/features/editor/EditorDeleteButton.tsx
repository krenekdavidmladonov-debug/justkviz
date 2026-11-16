export function EditorDeleteButton({ label, disabled, reason, compact = false, onClick }: {
  readonly label: string;
  readonly disabled: boolean;
  readonly reason?: string;
  readonly compact?: boolean;
  readonly onClick: () => void;
}) {
  return <button type="button" className={compact ? 'editor-delete-button outline-delete-button' : 'danger-button editor-delete-button'} aria-label={label} title={disabled && reason ? reason : label} disabled={disabled} onClick={onClick}>
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
    {!compact && label}
  </button>;
}
