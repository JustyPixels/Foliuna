// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DemoAdapter } from '../src/main/adapters/demo';
import { PostGrid } from '../src/renderer/PostGrid';
const { imageRender } = vi.hoisted(() => ({ imageRender: vi.fn() }));
vi.mock('../src/renderer/PostImage', () => ({ PostImage: () => { imageRender(); return <span>Preview</span>; } }));
afterEach(cleanup);
it('does no image rendering for unchanged grid props and renders only an appended card', async () => {
  const demo = new DemoAdapter('e621'); const posts = (await demo.search({ provider: 'e621', tags: '', page: 1 })).posts;
  const onSelect = vi.fn(); const { rerender } = render(<PostGrid posts={posts} mode="natural" busy={false} onSelect={onSelect} />);
  expect(imageRender).toHaveBeenCalledTimes(24); imageRender.mockClear();
  rerender(<PostGrid posts={posts} mode="natural" busy={false} onSelect={onSelect} />); expect(imageRender).not.toHaveBeenCalled();
  const appended = [...posts, await demo.getPost(1025)];
  rerender(<PostGrid posts={appended} mode="natural" busy={false} onSelect={onSelect} />); expect(imageRender).toHaveBeenCalledTimes(1);
  rerender(<PostGrid posts={appended} mode="natural" busy onSelect={onSelect} />);
  expect(screen.getAllByRole('button', { name: /^View post/ }).every((button) => button.hasAttribute('disabled'))).toBe(true);
});
