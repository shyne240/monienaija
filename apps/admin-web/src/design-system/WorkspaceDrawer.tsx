import React, { useEffect, useRef } from 'react';
import { useDialogFocus } from '../utils/use-dialog-focus';
import './workspace-patterns.css';

/** Contextual modal surface. Dismissal is delegated to the owning workflow so
 * dirty-state, in-flight and uncertain-outcome safeguards remain authoritative. */
export const WorkspaceDrawer: React.FC<{
  label: string;
  className?: string;
  onDismiss: () => void;
  children: React.ReactNode;
}> = ({ label, className, onDismiss, children }) => {
  const ref = useRef<HTMLElement>(null);
  useDialogFocus(ref, true, onDismiss);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  return <div className="one-workspace-drawer">
    <div className="one-workspace-drawer__backdrop" aria-hidden="true" onClick={onDismiss} />
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={['one-workspace-drawer__surface', className].filter(Boolean).join(' ')}>{children}</section>
  </div>;
};

export const WorkspaceFilterTabs: React.FC<{
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => <div className="one-workspace-filter-tabs" role="group" aria-label={label}>
  {options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}
</div>;
