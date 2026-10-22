import { expect, it } from 'vitest';
import { swipeDirection } from '../src/renderer/useSwipe';
it('navigates deliberate horizontal swipes and ignores taps, vertical scrolling and slow pans', () => {
  expect(swipeDirection(-100, 15, 250)).toBe('next');
  expect(swipeDirection(100, -15, 250)).toBe('previous');
  for (const [x, y, time] of [[10, 0, 100], [100, 100, 100], [100, 0, 1000], [0, 120, 200]]) expect(swipeDirection(x, y, time)).toBeNull();
});
