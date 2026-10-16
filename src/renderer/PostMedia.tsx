import { useState } from 'react';
import type { Post } from '../shared/contracts';
import { PostImage } from './PostImage';

export function PostMedia({ post, size }: { post: Post; size: 'sample' | 'original' }) {
  const [flash, setFlash] = useState(false);
  const [failed, setFailed] = useState(false);
  if (['webm', 'mp4'].includes(post.file.extension) && post.originalUrl) return <>
    <video key={post.originalUrl} controls preload="none" poster={post.sampleUrl ?? post.previewUrl ?? undefined} src={post.originalUrl}
      aria-label={`Video of post ${post.id}`} onError={() => setFailed(true)} />
    {failed && <p role="alert">Video could not play. Retry by reopening this post; this format may not be supported.</p>}
  </>;
  if (post.file.extension === 'swf' && post.originalUrl) return flash ?
    <iframe title={`Flash of post ${post.id}`} sandbox="allow-scripts allow-same-origin" src={`foliuna://player/swf.html#${post.archive ? `gallery/${post.archive.sha256}` : `${post.provider}/${post.id}`}`} /> :
    <div><PostImage urls={[post.sampleUrl, post.previewUrl]} alt={`Flash preview of post ${post.id}`} /><button onClick={() => setFlash(true)}>Play Flash with Ruffle</button><p>Isolated player · external resources blocked · compatibility varies</p></div>;
  return <PostImage urls={size === 'original' || post.file.extension === 'gif' ? [post.originalUrl] : [post.sampleUrl, post.previewUrl]}
    alt={`${size === 'original' ? 'Full-size image' : 'Sample'} of post ${post.id}`} unavailable={post.unavailable} />;
}
