import { useCallback, useRef } from 'react';
import { useStickToBottomContext } from 'use-stick-to-bottom';

const ANIMATION_DURATION_MS = 150;
const BUFFER_MS = 50;

interface ScrollAnchor {
  relativeTop: number;
  scrollTop: number;
}

export function useCollapseScrollPreservation(
  containerRef: React.RefObject<HTMLElement | null>,
  onStateChangeRef: React.RefObject<((open: boolean) => void) | undefined>,
) {
  const { isAtBottom, scrollRef } = useStickToBottomContext();

  const isAtBottomRef = useRef(isAtBottom);
  isAtBottomRef.current = isAtBottom;

  const anchorRef = useRef<ScrollAnchor | null>(null);
  const timerRef = useRef<number | null>(null);

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (isAtBottomRef.current) {
        onStateChangeRef.current?.(open);
        return;
      }

      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const element = containerRef.current;
      const scrollEl = scrollRef.current;
      if (element && scrollEl) {
        const elementRect = element.getBoundingClientRect();
        const scrollRect = scrollEl.getBoundingClientRect();
        anchorRef.current = {
          relativeTop: elementRect.top - scrollRect.top,
          scrollTop: scrollEl.scrollTop,
        };
      }

      onStateChangeRef.current?.(open);

      timerRef.current = window.setTimeout(() => {
        const anchor = anchorRef.current;
        const el = containerRef.current;
        const sEl = scrollRef.current;

        if (!anchor || !el || !sEl) {
          anchorRef.current = null;
          timerRef.current = null;
          return;
        }

        const elementRect = el.getBoundingClientRect();
        const scrollRect = sEl.getBoundingClientRect();
        const newRelativeTop = elementRect.top - scrollRect.top;
        const delta = newRelativeTop - anchor.relativeTop;

        if (Math.abs(delta) > 1) {
          sEl.scrollTop = anchor.scrollTop + delta;
        }

        anchorRef.current = null;
        timerRef.current = null;
      }, ANIMATION_DURATION_MS + BUFFER_MS);
    },
    [containerRef, scrollRef, onStateChangeRef],
  );

  return { onOpenChange };
}
