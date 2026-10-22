import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Playback } from './VideoPlayer';
import type { Post } from '../shared/contracts';
import { useDialog } from './useDialog';
import { PostMedia } from './PostMedia';
import { Icon } from './Icon';
import { useSwipe } from './useSwipe';

export function MediaViewer({ post, size, busy, error, onClose, onPrevious, onNext, playback }: { post: Post | null; size: 'sample' | 'original'; busy: boolean; error: string; onClose(): void; onPrevious?(): void; onNext?(): void; playback?: RefObject<Playback | null> }) {
  const ref = useDialog();
  const [zoom, setZoom] = useState(1), [fullscreenError, setFullscreenError] = useState('');
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const swipe = useSwipe(onPrevious, onNext, zoom === 1 && !busy);
  useEffect(() => {
    let active = true;
    document.documentElement.dataset.mediaFullscreen = 'true';
    void window.foliuna.setFullscreen(true).then((result) => { if (active && !result.ok) setFullscreenError(result.error.message); }).catch(() => { if (active) setFullscreenError('System fullscreen could not start.'); });
    return () => { active = false; delete document.documentElement.dataset.mediaFullscreen; void window.foliuna.setFullscreen(false).catch(() => {}); };
  }, []);
  useEffect(() => { setZoom(1); ref.current?.focus({ preventScroll: true }); }, [post?.provider, post?.id]);
  const image = post && !['webm', 'mp4', 'swf'].includes(post.file.extension);
  return <dialog ref={ref} tabIndex={-1} className="media-viewer" aria-label="Fullscreen media" onClose={(event) => { event.stopPropagation(); onClose(); }} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }} onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    if ((event.target as HTMLElement).closest('input,select,[data-media-controls]')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); if (!busy) (event.key === 'ArrowLeft' ? onPrevious : onNext)?.(); }
    if (event.key === 'F11') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <header className="immersive-toolbar"><span>{post ? `Post #${post.id}` : 'Loading post…'}</span>
      <button aria-label="Previous post" disabled={!onPrevious || busy} onClick={onPrevious}><Icon name="previous" /></button>
      <button aria-label="Next post" disabled={!onNext || busy} onClick={onNext}><Icon name="next" /></button>
      {image && <><button aria-pressed={zoom > 1} onClick={() => setZoom(zoom === 1 ? 2 : 1)}>{zoom === 1 ? 'Zoom' : 'Fit'}</button><input aria-label="Image zoom" type="range" min="1" max="3" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></>}
      <button onClick={onClose} aria-label="Close fullscreen media"><Icon name="close" /></button>
    </header>
    {(fullscreenError || error) && <p role="alert" className="viewer-error">{fullscreenError || error}</p>}
    <div className={`immersive-media ${zoom > 1 ? 'zoomed' : ''}`} {...swipe} onPointerDown={(event) => {
      swipe.onPointerDown(event);
      if (zoom > 1 && event.pointerType === 'mouse' && event.button === 0) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pan.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; }
    }} onPointerMove={(event) => { if (pan.current) { event.currentTarget.scrollLeft = pan.current.left + pan.current.x - event.clientX; event.currentTarget.scrollTop = pan.current.top + pan.current.y - event.clientY; } }} onPointerUp={(event) => { pan.current = null; swipe.onPointerUp(event); }} onPointerCancel={() => { pan.current = null; swipe.onPointerCancel(); }} onDoubleClick={() => { if (image) setZoom(zoom === 1 ? 2 : 1); }}>
      <div className="immersive-canvas" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
        {post && !error ? <PostMedia key={`${post.provider}:${post.id}`} post={post} size={size} onFullscreen={onClose} playback={playback} /> : <p role="status">{error ? 'This post cannot be displayed.' : 'Loading post…'}</p>}
      </div>
    </div>
  </dialog>;
}
