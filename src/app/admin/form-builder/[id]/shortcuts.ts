/** Keys typed into a text box belong to the box (its own undo, Backspace…), not to the designer. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type);
}

export const isModKey = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

export const isDeleteKey = (e: KeyboardEvent) => (e.key === 'Delete' || e.key === 'Backspace') && !e.metaKey && !e.ctrlKey && !e.altKey;

/** Marks UI whose clicks keep the current selection (everything else counts as blank space). */
export const KEEP_SELECTION = { 'data-keep-selection': '' } as const;

/** A pointer press on blank space: outside every element marked with KEEP_SELECTION and not on the page scrollbar. */
export function isBlankPress(e: PointerEvent): boolean {
  const t = e.target;
  if (!(t instanceof Element)) return false;
  if (t === document.documentElement && (e.clientX >= t.clientWidth || e.clientY >= t.clientHeight)) return false;
  return t.closest('[data-keep-selection]') === null;
}
