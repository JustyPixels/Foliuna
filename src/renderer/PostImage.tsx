import { useEffect, useRef, useState } from 'react';

export function PostImage({ urls, alt, unavailable, lazy = false, onReady }: { urls: (string | null)[]; alt: string; unavailable?: boolean; lazy?: boolean; onReady?(image: HTMLImageElement): void }) {
  const sources = [...new Set(urls.filter((url): url is string => url !== null))];
  return <Image key={sources.join('|')} sources={sources} alt={alt} unavailable={unavailable} lazy={lazy} onReady={onReady} />;
}

function Image({ sources, alt, unavailable, lazy, onReady }: { sources: string[]; alt: string; unavailable?: boolean; lazy: boolean; onReady?(image: HTMLImageElement): void }) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const frame = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!lazy || typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!lazy || typeof IntersectionObserver === 'undefined' || !frame.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: '160px' });
    observer.observe(frame.current); return () => observer.disconnect();
  }, [lazy]);
  const url = sources[index];
  return <div className="media-frame" ref={frame}>
    {url && visible && <img key={`${index}:${retry}`} src={url} alt={alt} loading={lazy ? 'lazy' : 'eager'} referrerPolicy="no-referrer"
      onLoad={(event) => { setLoaded(true); onReady?.(event.currentTarget); }} onError={() => { setLoaded(false); setIndex((value) => value + 1); }} />}
    {!loaded && <div className="media-status"><span>{unavailable ? 'Post unavailable' : url ? 'Loading image…' : sources.length ? 'Image could not load.' : 'No image available.'}</span>
      {!url && sources.length > 0 && !lazy && <button onClick={(event) => { event.stopPropagation(); setIndex(0); setLoaded(false); setRetry((value) => value + 1); }}>Retry image</button>}
    </div>}
  </div>;
}
