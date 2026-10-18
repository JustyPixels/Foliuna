import type { Post, Preferences } from '../shared/contracts';
import { PostImage } from './PostImage';
import { memo, useEffect, useState } from 'react';
import { GalleryVideoPreview } from './GalleryVideoPreview';
import { cacheThumbnail } from './thumbnail';
import { isAndroid } from './platform';
const ratingNames = { s: 'Safe', q: 'Questionable', e: 'Explicit' };

type GridProps = { posts: Post[]; mode: Preferences['gridMode']; busy: boolean; onSelect(post: Post): void };
export const PostGrid = memo(function PostGrid({ posts, mode, busy, onSelect }: GridProps) {
  const count = () => isAndroid ? window.innerWidth < 700 ? 2 : 4 : window.innerWidth >= 1600 ? 5 : window.innerWidth <= 1200 ? 3 : 4;
  const [columns, setColumns] = useState(count);
  useEffect(() => {
    const resize = () => setColumns(count()); window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  const buckets: Post[][] = Array.from({ length: columns }, () => []);
  if (mode === 'natural') posts.forEach((post, index) => buckets[index % columns].push(post));
  const card = (post: Post) => <PostCard key={`${post.provider}:${post.id}`} post={post} mode={mode} busy={busy} onSelect={onSelect} />;
  // shortcut: Loaded cards remain mounted; virtualize if long sessions need bounded DOM memory.
  return <div className={`post-grid grid-${mode} ${busy ? 'loading' : ''}`}>
    {mode === 'natural' ? buckets.map((posts, column) => <div className="post-column" key={column}>{posts.map(card)}</div>) : posts.map(card)}
  </div>;
});

const PostCard = memo(function PostCard({ post, mode, busy, onSelect }: Omit<GridProps, 'posts'> & { post: Post }) {
  return <button className="post-card" disabled={busy} onClick={() => onSelect(post)} aria-label={`View post ${post.id}`}>
      <div className="post-image" style={mode === 'natural' && post.file.width > 0 && post.file.height > 0 ? { aspectRatio: `${post.file.width}/${post.file.height}` } : undefined}>
        {post.archive && ['webm', 'mp4'].includes(post.file.extension) ? <GalleryVideoPreview post={post} /> : <PostImage urls={post.file.extension === 'gif' ? [post.originalUrl, post.previewUrl] : [post.previewUrl, post.sampleUrl]}
          alt={`${post.tags.species.join(', ') || 'Artwork'} preview`} unavailable={post.unavailable} lazy onReady={(image) => { if (post.archive && image.src === post.originalUrl) void cacheThumbnail(post.archive.sha256, image); }} />}
        <span className={`rating-badge rating-${post.rating}`}>{ratingNames[post.rating]}</span>
        <span className="file-badge">{['webm', 'mp4'].includes(post.file.extension) ? '▶ VIDEO' : post.file.extension === 'swf' ? 'FLASH' : post.file.extension.toUpperCase() || 'FILE'}</span>
      </div><div className="post-caption"><strong>{post.tags.artist.join(', ') || 'Unknown artist'}</strong><span>#{post.id}</span></div>
      <div className="post-tags">{post.archive?.missing ? 'Original missing · metadata preserved' : post.tags.species.concat(post.tags.general).slice(0, 3).join(' · ')}</div>
    </button>;
});
