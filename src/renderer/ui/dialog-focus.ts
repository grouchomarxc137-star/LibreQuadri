import { useEffect, type RefObject } from "react";

/** Only the boundary of the modal's Tab sequence wraps; normal traversal stays native. */
export function dialogTabTarget<T>(controls: readonly T[], active: T | null, backwards: boolean): T | null {
  if (!controls.length) return null;
  const index = active === null ? -1 : controls.indexOf(active);
  return index < 0 ? (backwards ? controls.at(-1)! : controls[0]!)
    : backwards && index === 0 ? controls.at(-1)!
    : !backwards && index === controls.length - 1 ? controls[0]! : null;
}

const CONTROLS = 'button, input, select, textarea, a[href], [tabindex]';

/** Bind the shared modal focus lifecycle. Exported so its actual listeners can be tested without a DOM framework. */
export function installDialogFocus(pane: HTMLElement, initialFocus?: HTMLElement | null): () => void {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const controls = () => [...pane.querySelectorAll<HTMLElement>(CONTROLS)].filter(control =>
    control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0);
  // Hidden workspace dialogs and covered modals must not pull focus from the current one.
  const current = () => pane.isConnected && [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
    .filter(modal => modal.getClientRects().length > 0).at(-1) === pane;
  const fallback = (available: readonly HTMLElement[]) =>
    initialFocus && available.includes(initialFocus) ? initialFocus : available[0] ?? pane;
  let lastFocused: HTMLElement | null = null;
  let suspendedSelect: HTMLElement | null = null;
  let repairingFocus = false;
  let disposed = false;
  const focusInside = (target: HTMLElement) => {
    repairingFocus = true;
    try { target.focus({ preventScroll: true }); }
    finally { repairingFocus = false; }
  };
  const repair = (records: readonly MutationRecord[] = []) => {
    if (disposed) return;
    if (!current()) { suspendedSelect = lastFocused = null; return; }
    const available = controls();
    const active = document.activeElement;
    // Remember the enabled editing control from focusin: Chromium may already have blurred it to body.
    // Mutation history also covers re-enabling before this observer delivery on a fast resolution.
    const disabledWhileFocused = lastFocused?.matches(':disabled') || records.some(record =>
      record.target === lastFocused && record.type === 'attributes' && record.attributeName === 'disabled' && record.oldValue === null);
    if (lastFocused?.tagName === 'SELECT' && pane.contains(lastFocused) && disabledWhileFocused)
      suspendedSelect = lastFocused;
    if (suspendedSelect && !pane.contains(suspendedSelect)) suspendedSelect = lastFocused = null;
    if (suspendedSelect && available.includes(suspendedSelect)) {
      const resume = suspendedSelect;
      suspendedSelect = null;
      // An enabled control already holding focus takes precedence over the previous editing position.
      if (active === pane || !available.includes(active as HTMLElement)) {
        lastFocused = resume;
        focusInside(resume);
        return;
      }
      lastFocused = active as HTMLElement;
    }
    if (active !== pane && !available.includes(active as HTMLElement)) {
      // Waiting on the pane avoids putting Enter on Annulla while an option is resolving.
      const target = suspendedSelect ? pane : fallback(available);
      if (!suspendedSelect) lastFocused = target;
      focusInside(target);
    }
  };
  const focused = () => {
    if (repairingFocus || disposed) return;
    if (current() && controls().includes(document.activeElement as HTMLElement)) {
      // A focus move outside our repair (native Tab, click or deliberate .focus()) supersedes restoration.
      suspendedSelect = null;
      lastFocused = document.activeElement as HTMLElement;
    }
    repair();
  };
  lastFocused = fallback(controls());
  focusInside(lastFocused);
  const tab = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !current()) return;
    const available = controls();
    const target = dialogTabTarget(available, document.activeElement as HTMLElement | null, event.shiftKey);
    if (target || !available.length) { event.preventDefault(); (target ?? pane).focus({ preventScroll: true }); }
  };
  // Native disabling can leave activeElement on the disabled control or move it to body without a focusin.
  // Observe the existing modal's controls and repair that loss after React commits the asynchronous state.
  const observer = new MutationObserver(repair);
  observer.observe(pane, { subtree: true, childList: true, attributes: true, attributeOldValue: true,
    attributeFilter: ['disabled', 'tabindex', 'hidden', 'class', 'style'] });
  const capture = { capture: true };
  document.addEventListener('focusin', focused);
  document.addEventListener('keydown', tab, capture);
  return () => {
    disposed = true;
    suspendedSelect = lastFocused = null;
    observer.disconnect();
    document.removeEventListener('focusin', focused);
    document.removeEventListener('keydown', tab, capture);
    if (opener?.isConnected && !opener.closest('[hidden]')) opener.focus();
    else document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  };
}

/** Initial focus, mutation-safe containment, contained Tab navigation, and return to the opener. Action keys remain native. */
export function useDialogFocus(dialog: RefObject<HTMLElement | null>, initialFocus?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const pane = dialog.current;
    if (pane) return installDialogFocus(pane, initialFocus?.current);
  }, [dialog, initialFocus]);
}
