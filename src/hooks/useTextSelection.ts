import { useEffect } from 'react';

/** Keep Select All inside an editor or the displayed content, never the app chrome. */
export function useTextSelection() {
  useEffect(() => {
    function selectAll(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== 'a' ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        event.defaultPrevented
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.closest('input, textarea') || target.isContentEditable)
      )
        return;
      event.preventDefault();
      const selection = window.getSelection();
      selection?.removeAllRanges();
      const content = document.querySelector('[data-selection-scope]');
      if (content && selection) {
        const range = document.createRange();
        range.selectNodeContents(content);
        selection.addRange(range);
      }
    }
    document.addEventListener('keydown', selectAll);
    return () => document.removeEventListener('keydown', selectAll);
  }, []);
}
