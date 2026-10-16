// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PostImage } from '../src/renderer/PostImage';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('waits until near the viewport, then retains the image instead of requesting it again on scrolling', () => {
  let callback: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class { constructor(fn: IntersectionObserverCallback) { callback = fn; } observe() {} disconnect = disconnect; });
  render(<PostImage urls={['/preview.png']} alt="Preview" lazy />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  act(() => callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  const image = screen.getByRole('img'); expect(disconnect).toHaveBeenCalled();
  act(() => callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(screen.getByRole('img')).toBe(image);
});
