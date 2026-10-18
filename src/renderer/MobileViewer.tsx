import { useState } from 'react';
import type { Post } from '../shared/contracts';
import { useDialog } from './useDialog';
import { PostMedia } from './PostMedia';

export function MobileViewer({ post, size, onClose }: { post: Post; size: 'sample' | 'original'; onClose(): void }) {
  const ref = useDialog();
  const [zoom, setZoom] = useState(false);
  return <dialog ref={ref} className="mobile-viewer" aria-label="Fullscreen media" onClose={(event) => { event.stopPropagation(); onClose(); }} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <header><span>Post #{post.id}</span><button aria-pressed={zoom} onClick={() => setZoom(!zoom)}>Zoom</button><button onClick={onClose} aria-label="Close fullscreen media">×</button></header>
    <div className={zoom ? 'mobile-media zoomed' : 'mobile-media'}><PostMedia post={post} size={size} /></div>
  </dialog>;
}
