import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Follow new text until the reader scrolls away or selects content. Keep a visible ID anchored. */
export function useReadingFollow(update: unknown, sessionId: string | null, mode: string) {
  const ref = useRef<HTMLElement>(null);
  const following = useRef(true);
  const [follow, setFollow] = useState(true);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const frame = useRef(0);
  const previous = useRef({ sessionId, mode });
  const adjusting = useRef(false);
  const setFollowing = useCallback((value: boolean) => {
    following.current = value;
    setFollow(value);
  }, []);
  const remember = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    const top = node.getBoundingClientRect().top;
    const visible = Array.from(node.querySelectorAll<HTMLElement>('[data-caption-id]')).find(
      (element) => element.getBoundingClientRect().bottom > top,
    );
    anchor.current = visible
      ? { id: visible.dataset.captionId!, offset: visible.getBoundingClientRect().top - top }
      : null;
  }, []);
  const selected = useCallback(() => {
    const selection = window.getSelection();
    return !!selection && !selection.isCollapsed && !!ref.current?.contains(selection.anchorNode);
  }, []);
  const sync = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;
      adjusting.current = true;
      if (following.current && !selected()) {
        node.scrollTop = node.scrollHeight;
      } else if (anchor.current) {
        const saved = anchor.current;
        const element = Array.from(node.querySelectorAll<HTMLElement>('[data-caption-id]')).find(
          (item) => item.dataset.captionId === saved.id,
        );
        if (element)
          node.scrollTop +=
            element.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.offset;
        else node.scrollTop = 0; // The anchored history expired; retain the earliest available text.
      }
      remember();
      // Scroll events arrive after layout; ignore only events caused by this adjustment.
      requestAnimationFrame(() => {
        adjusting.current = false;
      });
    });
  }, [remember, selected]);
  useLayoutEffect(() => {
    const changed =
      mode !== previous.current.mode ||
      (sessionId !== null && sessionId !== previous.current.sessionId);
    previous.current = { sessionId: sessionId ?? previous.current.sessionId, mode };
    if (changed) {
      anchor.current = null;
      setFollowing(true);
      sync();
    }
  }, [sessionId, mode, setFollowing, sync]);
  useLayoutEffect(sync, [update, sync]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    const selection = () => {
      if (selected()) {
        setFollowing(false);
        remember();
      }
    };
    // User intent wins even if a new snapshot scheduled a scroll on this frame.
    const interact = () => {
      adjusting.current = false;
      remember();
    };
    node.addEventListener('wheel', interact, { passive: true });
    node.addEventListener('pointerdown', interact);
    document.fonts?.addEventListener('loadingdone', sync);
    document.addEventListener('selectionchange', selection);
    return () => {
      observer.disconnect();
      node.removeEventListener('wheel', interact);
      node.removeEventListener('pointerdown', interact);
      document.fonts?.removeEventListener('loadingdone', sync);
      cancelAnimationFrame(frame.current);
      document.removeEventListener('selectionchange', selection);
    };
  }, [remember, selected, setFollowing, sync]);
  function onScroll() {
    if (adjusting.current) return;
    const node = ref.current;
    if (!node) return;
    setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 48 && !selected());
    remember();
  }
  function jumpLatest() {
    window.getSelection()?.removeAllRanges();
    setFollowing(true);
    sync();
  }
  return { ref, follow, onScroll, jumpLatest };
}
