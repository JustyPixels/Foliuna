import { useEffect, useRef, useState } from 'react';
import type { Post } from '../shared/contracts';
import { cacheThumbnail } from './thumbnail';

export function GalleryVideoPreview({ post }: { post: Post }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  const [generate, setGenerate] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '160px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  return <div className="media-frame" ref={ref}>
    {visible && !generate && post.previewUrl && !failed && <img src={post.previewUrl} alt={`Video preview of post ${post.id}`} onError={() => { if (attempted) setFailed(true); else setGenerate(true); }} />}
    {visible && generate && post.originalUrl && !failed && <video src={post.originalUrl} muted preload="auto" aria-label={`Preparing video preview ${post.id}`} onError={() => setFailed(true)} onLoadedData={(event) => {
      if (attempted) return; setAttempted(true);
      void cacheThumbnail(post.archive!.sha256, event.currentTarget).then((ok) => { if (ok) setGenerate(false); });
    }} />}
    {(!visible || failed || !post.originalUrl) && <div className="media-status">Video preview unavailable</div>}
  </div>;
}
