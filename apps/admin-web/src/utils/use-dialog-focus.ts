import { RefObject, useEffect, useRef } from 'react';

// Only the most recently opened managed modal may trap focus or handle Escape.
// This prevents competing focus traps when a guarded workflow opens a confirmation.
const dialogStack: HTMLElement[] = [];

/** Focus and keyboard behavior for the console's modal dialogs. */
export function useDialogFocus<T extends HTMLElement>(
  dialog: RefObject<T>,
  open: boolean,
  onDismiss: () => void,
  restoreFocusRef?: RefObject<HTMLElement>,
) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    if (!open || !dialog.current) return;
    const root = dialog.current;
    dialogStack.push(root);
    const isTop = () => dialogStack[dialogStack.length - 1] === root;
    const previous = restoreFocusRef?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])',
    )).filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
    (focusable()[0] ?? root).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTop()) return;
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
      if (isTop() && event.target instanceof Node && !root.contains(event.target)) (focusable()[0] ?? root).focus();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      const wasTop = isTop();
      const index = dialogStack.lastIndexOf(root);
      if (index !== -1) dialogStack.splice(index, 1);
      const next = dialogStack[dialogStack.length - 1];
      if (wasTop && previous?.isConnected && (!next || next.contains(previous))) previous.focus();
    };
  }, [dialog, open]);
}
