import React, { useEffect, useId, useRef, useState } from 'react';
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
  disabled?: boolean;
}> = ({ label, value, options, onChange, disabled }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const hintId = useId();
  const optionLabels = options.map(option => option.label).join('\u0000');
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [optionLabels]);
  return <div className={`one-workspace-filter-control${overflowing ? ' one-workspace-filter-control--overflow' : ''}`}>
    <div ref={ref} className="one-workspace-filter-tabs" role="group" aria-label={label} aria-describedby={overflowing ? hintId : undefined}>
      {options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
    {overflowing && <p id={hintId} className="one-workspace-filter-hint">Scroll horizontally to see all filters.</p>}
  </div>;
};
