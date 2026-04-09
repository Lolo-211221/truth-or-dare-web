import { useCallback, useRef, type TouchEvent } from 'react';

/**
 * Host-only: swipe left on a card to skip (same as skip round).
 * Uses passive-friendly touch tracking.
 */
export function useCardSwipe(onSwipeLeft: () => void, enabled: boolean) {
  const startX = useRef<number | null>(null);

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      if (!enabled) return;
      startX.current = e.touches[0]?.clientX ?? null;
    },
    [enabled],
  );

  const onTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!enabled || startX.current == null) return;
      const endX = e.changedTouches[0]?.clientX ?? startX.current;
      const dx = endX - startX.current;
      startX.current = null;
      if (dx < -70) onSwipeLeft();
    },
    [enabled, onSwipeLeft],
  );

  return {
    swipeHandlers: enabled
      ? { onTouchStart, onTouchEnd, style: { touchAction: 'pan-y' as const } }
      : {},
  };
}
