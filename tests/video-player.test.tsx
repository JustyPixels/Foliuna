// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { VideoPlayer } from '../src/renderer/VideoPlayer';
afterEach(cleanup);
it('keeps the seek slider at the requested time before asynchronous media time updates', () => {
  render(<VideoPlayer src="/clip.webm" label="Test video" />);
  const video = screen.getByLabelText('Test video') as HTMLVideoElement;
  video.pause = () => {};
  Object.defineProperty(video, 'duration', { value: 10 });
  fireEvent.durationChange(video);
  const position = screen.getByLabelText('Video position');
  fireEvent.change(position, { target: { value: '4.2' } });
  expect(video.currentTime).toBe(4.2); expect(position).toHaveValue('4.2');
  fireEvent.change(position, { target: { value: '0' } });
  expect(video.currentTime).toBe(0); expect(position).toHaveValue('0');
  let playbackStarts = 0; video.play = async () => { playbackStarts++; };
  fireEvent.keyDown(screen.getByLabelText('Playback speed'), { key: ' ' });
  fireEvent.keyDown(screen.getByLabelText('Playback speed'), { key: 'ArrowRight' });
  expect(playbackStarts).toBe(0); expect(video.currentTime).toBe(0);
});
