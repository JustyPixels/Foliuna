import { useEffect, useRef, useState } from 'react';
import { TAG_CATEGORIES, type Post } from '../shared/contracts';
import { useDialog } from './useDialog';
import { PostMedia } from './PostMedia';
import { capabilities } from './platform';
import { MobileViewer } from './MobileViewer';
const ratingNames = { s: 'Safe', q: 'Questionable', e: 'Explicit' };
const size = (bytes: number) => bytes > 0 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : 'Size not supplied';

export function PostDetails({ selected, safeOnly, demo, libraryReady, downloading, message, downloadError, onDownload, onCancelDownload, onClose, onPrevious, onNext, busy, position, navigationError, onTag, favoriteTags, onFavorite, onCollections }: {
  selected: Post; safeOnly: boolean; demo: boolean; libraryReady: boolean; downloading: boolean; message: string; downloadError: string;
  onDownload(post: Post): Promise<void>; onCancelDownload(): Promise<void>; onClose(): void;
  onPrevious?: () => void; onNext?: () => void; busy: boolean; position: string; navigationError: string;
  onCollections?(post: Post): void; onTag(tag: string, exclude: boolean): void; favoriteTags: string[]; onFavorite(tag: string): void;
}) {
  const ref = useDialog();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState('');
  const [imageSize, setImageSize] = useState<'sample' | 'original'>('sample');
  const [tagMenu, setTagMenu] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const tagOpener = useRef<HTMLButtonElement | null>(null);
  function closeTagMenu() { setTagMenu(null); tagOpener.current?.focus(); }
  const loading = !post && !error;
  useEffect(() => {
    let active = true;
    setError(''); setPost(null); setImageSize('sample'); setTagMenu(null); setOpenError(''); setFullscreen(false);
    if (ref.current) ref.current.scrollTop = 0;
    (selected.archive ? window.foliuna.galleryPost({ sha256: selected.archive.sha256, provider: selected.provider, id: selected.id }) : window.foliuna.getPost({ provider: selected.provider, id: selected.id })).then((response) => {
      if (!active) return;
      if (response.ok) {
        if (safeOnly && response.value.rating !== 's') setError('This post is no longer rated safe. Select All ratings before viewing it.');
        else setPost(response.value);
      } else setError(response.error.message);
    }).catch(() => { if (active) setError('Could not load post details. Please try again.'); });
    return () => { active = false; };
  }, [selected.provider, selected.id, selected.archive?.sha256, retry, safeOnly]);

  async function openPost() {
    setOpening(true); setOpenError('');
    try {
      const response = await window.foliuna.openPost({ provider: selected.provider, id: selected.id, ...(selected.archive ? { archiveSha: selected.archive.sha256 } : {}) });
      if (!response.ok) setOpenError(response.error.message);
    } catch { setOpenError('Could not open the source post.'); }
    finally { setOpening(false); }
  }

  return <dialog ref={ref} className="details-dialog" aria-labelledby="post-title" onCancel={(event) => { event.preventDefault(); if (tagMenu) closeTagMenu(); else onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onKeyDown={(event) => {
    if (event.target instanceof HTMLElement && event.target.closest('input,select,textarea,video,iframe,[role="menu"]')) return;
    if (!busy && !loading && event.key === 'ArrowLeft' && onPrevious) { event.preventDefault(); onPrevious(); }
    if (!busy && !loading && event.key === 'ArrowRight' && onNext) { event.preventDefault(); onNext(); }
  }}>
    <div className="details-content"><header><div><p className="eyebrow">{selected.source?.name ?? selected.provider} / POST DETAILS</p><h2 id="post-title">Post #{selected.id}</h2></div><button className="close-button" aria-label="Close post details" onClick={onClose}>×</button></header>
      <nav className="post-navigation" aria-label="Post navigation"><button disabled={!onPrevious || busy || loading} onClick={onPrevious}>← Previous post</button><span>{position}</span><button disabled={!onNext || busy || loading} onClick={onNext}>{busy ? 'Loading…' : 'Next post →'}</button></nav>
      {navigationError && <p role="alert" className="error-message">{navigationError}</p>}
      {!post && !error && <p role="status">Loading post details…</p>}
      {error && <div role="alert" className="error-message">{error}<button onClick={() => setRetry((value) => value + 1)}>Retry details</button></div>}
      {post && <div className="detail-grid"><div className="viewer-column"><div className="viewer-controls"><label htmlFor="image-size">Image size</label><select id="image-size" value={imageSize} onChange={(event) => setImageSize(event.target.value as 'sample' | 'original')} disabled={['webm', 'mp4', 'swf', 'gif'].includes(post.file.extension)}><option value="sample">Sample</option><option value="original" disabled={!post.originalUrl}>Full size</option></select>
        <button disabled={post.unavailable} onClick={() => { if (!capabilities.floatingViewer) { setFullscreen(true); return; } void window.foliuna.openViewer(post.archive ? { archiveSha: post.archive.sha256, source: { provider: post.provider, id: post.id }, size: imageSize } : { provider: post.provider, id: post.id, size: imageSize }).then((response) => { if (!response.ok) setOpenError(response.error.message); }).catch(() => setOpenError('Could not open the media window.')); }}>{capabilities.floatingViewer ? 'Open media window ↗' : 'Fullscreen'}</button></div>
        <div className="detail-preview"><PostMedia key={`${post.provider}:${post.id}`} post={post} size={imageSize} /><span>{post.archive ? 'Archived original' : ['webm', 'mp4', 'swf', 'gif'].includes(post.file.extension) ? 'Original media' : imageSize === 'original' ? 'Full-resolution image' : 'Sample image'}{!post.archive && ' · Unsaved'}</span></div>
      </div>
        <div className="detail-info"><div className="detail-badges"><span className={`rating-badge rating-${post.rating}`}>{['s', 'sensitive'].includes(post.sourceRating ?? '') && post.source?.safeRating === 'g' ? 'Sensitive' : ratingNames[post.rating]}</span><span>{post.file.extension.toUpperCase()} · {size(post.file.size)}</span></div><dl><div><dt>Dimensions</dt><dd>{post.file.width} × {post.file.height}</dd></div><div><dt>Score / favorites</dt><dd>{post.score} / {post.favorites}</dd></div><div><dt>Posted</dt><dd>{post.createdAt && !Number.isNaN(Date.parse(post.createdAt)) ? new Date(post.createdAt).toLocaleDateString() : 'Unknown'}</dd></div></dl>
          <button className="primary-button source-button" onClick={() => void openPost()} disabled={demo || opening}>{demo ? 'Fictional demo post' : opening ? 'Opening…' : 'Open source post ↗'}</button>{openError && <p role="alert" className="error-message">{openError}</p>}
          {!post.archive && <button className="archive-button" disabled={demo || downloading || post.unavailable || !post.file.url} onClick={() => void onDownload(post)}>{downloading ? 'Archiving…' : libraryReady ? 'Download original' : 'Set up archive folder'}</button>}
          {downloading && <button className="cancel-button" onClick={() => void onCancelDownload()}>Cancel download</button>}
          {message && <p role="status" className="success-message">{message}</p>}{downloadError && <p role="alert" className="error-message">{downloadError}</p>}
          {post.archive && onCollections && <button disabled={downloading || busy} onClick={() => onCollections(post)}>Manage collections</button>}
          {post.archive && <section className="archive-provenance"><h3>Archived source history</h3><p>Captured {new Date(post.archive.capturedAt).toLocaleString()} · {post.archive.sourceCount} source{post.archive.sourceCount === 1 ? '' : 's'}</p><code>{post.archive.sha256}</code><p>{post.archive.provenance.map((source) => `${source.provider} #${source.id}`).join(' · ')}</p>{post.archive.missing && <p role="alert">Original missing or unavailable. Metadata is preserved. Use Check library files to look for moved media.</p>}</section>}
          <h3>Categorized tags</h3>{post.source && ['gelbooru', 'moebooru'].includes(post.source.engine) && <p className="settings-help">This API supplies a flat tag list. Tags are kept under general; original site metadata is preserved when downloaded.</p>}{TAG_CATEGORIES.filter((category) => post.tags[category].length > 0).map((category) => <div className={`tag-category category-${category}`} key={category}><h4>{category}</h4><div>{post.tags[category].map((tag, index) => <button className="tag-button" aria-label={`Tag ${tag}`} aria-haspopup="menu" aria-expanded={tagMenu === tag} key={`${tag}:${index}`} onClick={(event) => { tagOpener.current = event.currentTarget; setTagMenu(tagMenu === tag ? null : tag); }}>{favoriteTags.includes(tag) ? '★ ' : ''}{tag}</button>)}</div></div>)}
          {tagMenu && <div className="tag-menu" role="menu" aria-label={`Actions for ${tagMenu}`} onKeyDown={(event) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault(); const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
          }}><strong>{tagMenu}</strong>
            <button role="menuitem" autoFocus onClick={() => onTag(tagMenu, false)}>Add to search bar</button><button role="menuitem" onClick={() => onTag(tagMenu, true)}>Exclude from search</button>
            <button role="menuitem" onClick={() => { onFavorite(tagMenu); closeTagMenu(); }}>{favoriteTags.includes(tagMenu) ? 'Unfavorite tag' : 'Favorite tag'}</button><button role="menuitem" onClick={closeTagMenu}>Close tag options</button></div>}
          <h3>Description</h3><p className="description">{post.description || 'No description provided.'}</p><h3>Sources</h3>{post.sources.length ? <ul className="source-list">{post.sources.map((source, index) => <li key={index}>{source}</li>)}</ul> : <p>No source links provided.</p>}

        </div></div>}
    </div>
    {fullscreen && post && <MobileViewer post={post} size={imageSize} onClose={() => setFullscreen(false)} />}
  </dialog>;
}
