import React from 'react';

import './primitives.css';

/**
 * M1 Admin design-system primitives.
 *
 * Deliberately presentation-only: no data fetching, no authorization checks, no
 * financial handling and no domain state. They render semantic HTML with an
 * explicit `mn-` class contract so the pilot never styles bare element selectors
 * or descendants of embedded workflows.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to the width of the containing block (used on narrow layouts). */
  block?: boolean;
  /** Decorative glyph rendered before the label and hidden from assistive tech. */
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block = false, icon, className, type = 'button', children, ...rest },
  ref,
) {
  const classes = [
    'mn-btn',
    `mn-btn--${variant}`,
    `mn-btn--${size}`,
    block ? 'mn-btn--block' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button ref={ref} type={type} className={classes} {...rest}>
      {icon ? (
        <span className="mn-btn__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="mn-btn__label">{children}</span>
    </button>
  );
});

export interface FieldProps {
  /** Persistent visible label. Rendered as a real <label> unless `as="group"`. */
  label: string;
  /** Id of the control this label describes. Required for accessibility. */
  htmlFor: string;
  /** Optional hint rendered below the control. */
  hint?: string;
  /** Wraps the control in a flex column; `inline` keeps label and control on one line. */
  layout?: 'stacked' | 'inline';
  className?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({
  label,
  htmlFor,
  hint,
  layout = 'stacked',
  className,
  children,
}) => (
  <div className={['mn-field', `mn-field--${layout}`, className].filter(Boolean).join(' ')}>
    <label className="mn-field__label" htmlFor={htmlFor}>
      {label}
    </label>
    <div className="mn-field__control">{children}</div>
    {hint ? (
      <p className="mn-field__hint" id={`${htmlFor}-hint`}>
        {hint}
      </p>
    ) : null}
  </div>
);

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type StatusShape = 'dot' | 'square' | 'hollow';

export interface StatusBadgeProps {
  tone?: StatusTone;
  /** Non-colour cue: the marker shape differs per state in addition to the label. */
  shape?: StatusShape;
  title?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Status badge. The textual label is always present and is the primary cue; the
 * marker is decorative and shape-varies so the state never depends on colour.
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  tone = 'neutral',
  shape = 'dot',
  title,
  className,
  children,
}) => (
  <span className={['mn-badge', `mn-badge--${tone}`, className].filter(Boolean).join(' ')} title={title}>
    <span className={`mn-badge__marker mn-badge__marker--${shape}`} aria-hidden="true" />
    {children}
  </span>
);

export type FeedbackTone = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  tone?: FeedbackTone;
  title?: string;
  /** Announced assertively for danger, politely otherwise. */
  live?: 'assertive' | 'polite' | 'off';
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const Alert: React.FC<AlertProps> = ({
  tone = 'danger',
  title,
  live,
  action,
  className,
  children,
}) => {
  const politeness = live ?? (tone === 'danger' ? 'assertive' : 'polite');
  const role = politeness === 'off' ? undefined : politeness === 'assertive' ? 'alert' : 'status';

  return (
    <div className={['mn-alert', `mn-alert--${tone}`, className].filter(Boolean).join(' ')}>
      <span className="mn-alert__mark" aria-hidden="true" />
      <div className="mn-alert__body" role={role} aria-live={politeness === 'off' ? undefined : politeness}>
        {title ? <p className="mn-alert__title">{title}</p> : null}
        <div className="mn-alert__text">{children}</div>
      </div>
      {action ? <div className="mn-alert__action">{action}</div> : null}
    </div>
  );
};

export interface ScrollRegionProps {
  /** Accessible name announced for the scrollable area. */
  label: string;
  /** Visible cue explaining that the region scrolls horizontally. */
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Named, keyboard-focusable local scroll region for inherently two-dimensional
 * data (the directory table). Page-level overflow is never required.
 */
export const ScrollRegion: React.FC<ScrollRegionProps> = ({ label, hint, className, children }) => (
  <div className={['mn-scroll-region', className].filter(Boolean).join(' ')}>
    <div className="mn-scroll-region__viewport" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
    {hint ? (
      <p className="mn-scroll-region__hint">
        <span className="mn-scroll-region__hint-glyph" aria-hidden="true">
          ↔
        </span>
        {hint}
      </p>
    ) : null}
  </div>
);

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  /** Focus target after a successful navigation. */
  headingId?: string;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  eyebrow,
  title,
  description,
  actions,
  headingId,
  className,
}) => (
  <header className={['mn-page-header', className].filter(Boolean).join(' ')}>
    <div className="mn-page-header__text">
      {eyebrow ? <p className="mn-page-header__eyebrow">{eyebrow}</p> : null}
      <h1 className="mn-page-header__title" id={headingId} tabIndex={-1}>
        {title}
      </h1>
      {description ? <p className="mn-page-header__description">{description}</p> : null}
    </div>
    {actions ? <div className="mn-page-header__actions">{actions}</div> : null}
  </header>
);
