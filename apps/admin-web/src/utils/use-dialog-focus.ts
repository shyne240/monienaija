import { RefObject, useEffect, useRef } from 'react';

/** Focus and keyboard behavior for the console's modal dialogs. */
export function useDialogFocus<T extends HTMLElement>(
  dialog: RefObject<T>,
  open: boolean,
  onDismiss: () => void,
) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!open || !dialog.current) return;
    const root = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    (focusable()[0] ?? root).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); root.focus(); return; }
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && (index < 0 || index === items.length - 1)) { event.preventDefault(); items[0].focus(); }
    };
    const onFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) (focusable()[0] ?? root).focus();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      if (previous?.isConnected) previous.focus();
    };
  }, [dialog, open]);
}
