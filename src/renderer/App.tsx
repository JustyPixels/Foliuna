import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEFAULT_PREFERENCES, MAX_PAGE, type LibraryReport, type Preferences, type LibraryStatus, type Post, type SearchRequest, type SearchResult } from '../shared/contracts';
import { BUILTIN_PROVIDERS } from '../shared/providers';
import { CollectionsPanel } from './CollectionsPanel';
import { CollectionDialog } from './CollectionDialog';
import type { Collection } from '../shared/contracts';
import type { ProviderDefinition } from '../shared/contracts';
import { SettingsDialog } from './SettingsDialog';
import { PostDetails } from './PostDetails';
import { PostGrid } from './PostGrid';
import { TagSearch } from './TagSearch';
import { AccountDialog } from './AccountDialog';
import { capabilities, isAndroid } from './platform';


type BrowseRequest = SearchRequest & { collectionId?: number };
const postKey = (post: Post) => post.archive?.sha256 ?? `${post.provider}:${post.id}`;
function Leaf() {
  return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M25 6C12 3 5 10 8 20c10 4 19-2 17-14Z" fill="currentColor"/><path d="m7 26 13-14M13 20l-1-7m5 3 6 1" stroke="#163e30" strokeWidth="2" strokeLinecap="round"/></svg>;
}

export function App() {
  const [safeOnly, setSafeOnly] = useState(true);
  const [providers, setProviders] = useState<ProviderDefinition[]>(BUILTIN_PROVIDERS);
  const [provider, setProvider] = useState('e621');
  const source = providers.find((entry) => entry.id === provider) ?? BUILTIN_PROVIDERS[0];
  function updateProviders(next: ProviderDefinition[]) { setProviders(next); if (!next.some((entry) => entry.id === provider)) { requestId.current++; searching.current = false; setBusy(false); setProvider('e621'); setSelected(null); setResult(null); setQuery(null); } }
  const [view, setView] = useState<'discover' | 'gallery' | 'collections'>('discover');
  const [maintaining, setMaintaining] = useState(false);
  const [report, setReport] = useState<LibraryReport | null>(null);
  const [galleryRevision, setGalleryRevision] = useState(0);
  const isCollections = view === 'collections';
  const isGallery = view !== 'discover';
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState<number | null>(null);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [collectPost, setCollectPost] = useState<Post | null>(null);
  const [membershipChanged, setMembershipChanged] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesBusy, setPreferencesBusy] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const searching = useRef(false);
  const [tags, setTags] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [query, setQuery] = useState<BrowseRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [library, setLibrary] = useState<LibraryStatus | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [selected, setSelected] = useState<Post | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const requestId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    window.foliuna.getSettings().then((response) => { if (active && response.ok && response.value.providers) setProviders(response.value.providers); }).catch(() => { if (active) setError('Could not load booru connections.'); });
    window.foliuna.getPreferences().then((response) => { if (active) { if (response.ok) setPreferences(response.value); else setError(response.error.message); setPreferencesReady(true); } }).catch(() => { if (active) { setError('Could not load browsing preferences.'); setPreferencesReady(true); } });
    window.foliuna.libraryStatus().then((response) => {
      if (!active) return;
      if (response.ok) setLibrary(response.value);
      else setLibraryError(true);
    }).catch(() => { if (active) setLibraryError(true); });
    return () => { active = false; requestId.current++; };
  }, []);

  async function search(request: BrowseRequest, append = false, mode = view): Promise<Post[]> {
    if (searching.current) return [];
    searching.current = true;
    const current = ++requestId.current;
    setBusy(true); setError(''); if (!append) setSelected(null);
    try {
      const response = await (mode !== 'discover' ? window.foliuna.gallerySearch({ tags: request.tags, page: request.page, safeOnly: request.safeOnly, ...(request.collectionId === undefined ? {} : { collectionId: request.collectionId }) }) : window.foliuna.search(request));
      if (current !== requestId.current) return [];
      if (response.ok) {
        const seen = new Set(append ? result?.posts.map(postKey) : []);
        const incoming = response.value.posts.filter((post) => { const key = postKey(post); if (seen.has(key)) return false; seen.add(key); return true; });
        if (append && !incoming.length) setError('No new posts were returned. Load another page manually if more results are available.');
        setResult((previous) => ({ ...response.value, posts: append && previous ? [...previous.posts, ...incoming] : incoming }));
        setQuery(request); return incoming;
      }
      else setError(response.error.message);
    } catch { if (current === requestId.current) setError('Foliuna could not complete the search. Please try again.'); }
    finally { if (current === requestId.current) { searching.current = false; setBusy(false); } }
    return [];
  }

  useEffect(() => {
    if (preferences.browsing !== 'infinite' || !result?.hasMore || !query || busy || maintaining || collectionBusy || error || selected || collectPost || settingsOpen || accountOpen || !sentinel.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !searching.current) void search({ ...query, page: result.page + 1 }, true);
    }, { rootMargin: '120px' });
    observer.observe(sentinel.current); return () => observer.disconnect();
  }, [preferences.browsing, result, query, busy, maintaining, error, selected, settingsOpen, accountOpen, collectPost, collectionBusy]);

  async function savePreferences(next: Preferences) {
    if (preferencesBusy) return;
    setPreferencesBusy(true);
    try {
      const response = await window.foliuna.savePreferences(next);
      if (response.ok) setPreferences(response.value); else setError(response.error.message);
    } catch { setError('Could not save browsing preferences.'); }
    finally { setPreferencesBusy(false); }
  }
  const selectedIndex = result?.posts.findIndex((post) => selected && postKey(post) === postKey(selected)) ?? -1;
  useEffect(() => {
    if (!isAndroid) return;
    const back = (event: Event) => {
      if (view !== 'discover') { event.preventDefault(); changeView('discover'); }
    };
    window.addEventListener('foliuna-back', back);
    return () => window.removeEventListener('foliuna-back', back);
  }, [view, busy, maintaining, collectionBusy]);
  async function nextPost() {
    if (!result || !query) return;
    if (selectedIndex + 1 < result.posts.length) setSelected(result.posts[selectedIndex + 1]);
    else if (result.hasMore && !busy) {
      const posts = await search({ ...query, page: result.page + 1 }, true);
      if (posts.length) setSelected(posts[0]);
    }
  }
  function tagAction(tag: string, exclude: boolean) {
    setTags((value) => [...value.split(/\s+/).filter((term) => term && term !== tag && term !== `-${tag}`), `${exclude ? '-' : ''}${tag}`].join(' '));
    setSelected(null); setTimeout(() => inputRef.current?.focus(), 0);
  }
  function favorite(tag: string) {
    void savePreferences({ ...preferences, favoriteTags: preferences.favoriteTags.includes(tag) ? preferences.favoriteTags.filter((item) => item !== tag) : [...preferences.favoriteTags, tag] });
  }

  function changeView(mode: 'discover' | 'gallery' | 'collections') {
    if (busy || maintaining || collectionBusy) return;
    requestId.current++; setView(mode); setSelected(null); setResult(null); setQuery(null); setTags(''); setError(''); setReport(null);
    if (mode === 'collections' && library?.root) { void openCollections(); return; }
    if (mode === 'gallery' && library?.root) void search({ provider: 'e621', tags: '', page: 1, safeOnly }, false, mode);
  }
  function chooseCollection(id: number | null) {
    setCollectionId(id); setTags(''); setResult(null); setQuery(null); setSelected(null);
    if (id !== null) void search({ provider: 'e621', tags: '', page: 1, safeOnly, collectionId: id }, false, 'collections');
  }
  async function openCollections(preferred = collectionId) {
    setCollectionBusy(true); setError('');
    try {
      const response = await window.foliuna.collectionList();
      if (!response.ok) { setError(response.error.message); return; }
      setCollections(response.value);
      const id = response.value.some((item) => item.id === preferred) ? preferred : response.value[0]?.id ?? null;
      chooseCollection(id);
    } catch { setError('Could not load collections. Your archived media remains available in Gallery.'); }
    finally { setCollectionBusy(false); }
  }
  async function maintenance(importing: boolean) {
    setMaintaining(true); setReport(null); setError(''); setSelected(null);
    try {
      const response = await (importing ? window.foliuna.importSidecars() : window.foliuna.reconcileLibrary());
      if (response.ok) { setReport(response.value); await search({ provider: 'e621', tags, page: 1, safeOnly }); } else setError(response.error.message);
    } catch { setError('The library task could not complete. Existing files and metadata were preserved.'); }
    finally {
      setMaintaining(false); setGalleryRevision((value) => value + 1);
      try { const response = await window.foliuna.libraryStatus(); if (response.ok) setLibrary(response.value); } catch { setLibraryError(true); }
    }
  }

  function submit(event: FormEvent) { event.preventDefault(); if (isCollections && collectionId === null) return; void search({ provider, tags, page: 1, safeOnly, ...(isCollections && collectionId ? { collectionId } : {}) }); }
  function suggest(tag: string) { setTags((value) => value.split(/\s+/).includes(tag) ? value : `${value} ${tag}`.trim()); inputRef.current?.focus(); }

  async function download(post: Post) {
    if (!library?.root) { setSelected(null); setSettingsOpen(true); return; }
    setDownloading(true); setDownloadMessage(''); setDownloadError('');
    try {
      const response = await window.foliuna.downloadPost({ provider: post.provider, id: post.id });
      if (response.ok) setDownloadMessage(`${post.source?.name ?? post.provider} #${post.id}: ${response.value.duplicate ? 'Already archived · source metadata updated.' : 'Saved to archive with tags and source metadata.'}`);
      else setDownloadError(response.error.message);
    } catch { setDownloadError('The archive request could not complete. Check the library in Settings before retrying.'); }
    finally {
      setDownloading(false);
      try { const status = await window.foliuna.libraryStatus(); if (status.ok) setLibrary(status.value); } catch { setLibraryError(true); }
    }
  }

  async function cancelDownload() {
    try { const response = await window.foliuna.cancelDownload(); if (!response.ok) setDownloadError(response.error.message); }
    catch { setDownloadError('Could not cancel the download.'); }
  }

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Workspace">
      <div className="brand"><span className="brand-mark"><Leaf /></span><span>Foliuna<small>Search · Archive · Collect</small></span></div>
      <p className="nav-label">YOUR WORKSPACE</p>
      <nav><button disabled={busy || maintaining || collectionBusy} className={`nav-item settings-nav ${!isGallery ? 'active' : ''}`} aria-current={!isGallery ? 'page' : undefined} onClick={() => changeView('discover')}><span aria-hidden="true">⌕</span> Discover</button>
        <button disabled={busy || maintaining || collectionBusy} className={`nav-item settings-nav ${view === 'gallery' ? 'active' : ''}`} aria-current={view === 'gallery' ? 'page' : undefined} onClick={() => changeView('gallery')}><span aria-hidden="true">▦</span> Gallery</button>
        <button disabled={busy || maintaining || collectionBusy} className={`nav-item settings-nav ${isCollections ? 'active' : ''}`} aria-current={isCollections ? 'page' : undefined} onClick={() => changeView('collections')}><span aria-hidden="true">▤</span> Collections</button>
        {!isAndroid && <><button className="nav-item settings-nav" disabled={maintaining || collectionBusy} onClick={() => setAccountOpen(true)}><span aria-hidden="true">☆</span> Account & favorites</button>
        <button className="nav-item settings-nav" disabled={maintaining || collectionBusy} onClick={() => { setSelected(null); setSettingsOpen(true); }}><span aria-hidden="true">⚙</span> Settings</button></>}
      </nav>

      <div className="sidebar-footer"><span className="status-dot" /> Release candidate <small>v0.5.0-rc.1</small></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><span>Workspace <span className="slash">/</span> <strong>{isCollections ? 'Collections' : isGallery ? 'Gallery' : 'Discover'}</strong></span><div className="topbar-right">
        {isAndroid && <><button aria-label="Account & favorites" onClick={() => setAccountOpen(true)}>☆</button><button aria-label="Settings" onClick={() => setSettingsOpen(true)}>⚙</button></>}
        <span className={`mode-badge ${library?.demo ? 'demo' : ''}`}>{isCollections ? 'OFFLINE COLLECTIONS' : isGallery ? 'OFFLINE GALLERY' : library ? library.demo ? 'LOCAL DEMO' : 'LIVE SEARCH' : 'STARTING'}</span>
        <span className="library-state">{libraryError ? 'Library unavailable' : library ? `Library ready · ${library.assets} saved` : 'Opening library…'}</span>
      </div></header>
      <main>
        <div className="intro"><div><h1>{isCollections ? 'Collections' : isGallery ? 'Gallery' : 'Discover'}<span>.</span></h1><p className="subtitle">{isCollections ? 'Group saved media without making extra copies.' : isGallery ? 'Your saved media, available offline.' : 'Search boorus and save your favorites.'}</p></div><span className="intro-leaf"><Leaf /></span></div>
        {library?.demo && <div className="demo-banner" role="note"><strong>Offline demo</strong> Fictional posts · no site requests.</div>}
        {library?.issue && <p role="alert" className="error-message">{library.issue}</p>}
        {downloading && <div role="status" className="download-banner">Downloading and preserving the original… <button onClick={() => void cancelDownload()}>Cancel download</button></div>}
        {downloadMessage && <p role="status" className="success-message">{downloadMessage}</p>}{downloadError && <p role="alert" className="error-message">{downloadError}</p>}
        {view === 'gallery' && <section className="gallery-tools" aria-label="Library maintenance"><div><strong>{library?.root ? `${library.assets} archived items` : 'Choose an archive folder to begin'}</strong></div><button disabled={busy || maintaining || collectionBusy || !library?.root || downloading} onClick={() => void maintenance(false)}>Check library files</button>{capabilities.importSidecars && <button disabled={busy || maintaining || collectionBusy || !library?.root || downloading} onClick={() => void maintenance(true)}>Import sidecars</button>}<button disabled={busy || maintaining || collectionBusy || !library?.root} onClick={() => { setGalleryRevision((value) => value + 1); void search({ provider: 'e621', tags, page: 1, safeOnly }); }}>Refresh gallery</button>{!library?.root && <button onClick={() => setSettingsOpen(true)}>Choose archive folder in Settings</button>}</section>}
        {maintaining && <p role="status" className="download-banner">Checking local files and preserving metadata… <button onClick={() => void cancelDownload()}>Stop library task</button></p>}
        {view === 'gallery' && report && <section className="library-report" aria-label="Library report"><p role="status">Checked {report.checked} · Imported {report.imported} · Recovered {report.recovered} · Missing {report.missing} · Invalid {report.invalid} · Conflicts {report.conflicts}</p>{report.issues.length > 0 && <details><summary>View file issues ({report.issues.length} shown)</summary><ul>{report.issues.map((issue, index) => <li key={index}><strong>{issue.file}</strong> — {issue.message}</li>)}</ul></details>}</section>}
        {isCollections && <CollectionsPanel collections={collections} selectedId={collectionId} ready={!!library?.root} disabled={busy || maintaining || collectionBusy || downloading} onResult={setCollections} onBusy={setCollectionBusy} onSetup={() => setSettingsOpen(true)} onSelect={chooseCollection} />}
        <section className="search-panel" aria-label="Booru search">
          <div className="provider-picker">{!isGallery && <><label htmlFor="booru-source">Booru source</label><select id="booru-source" value={provider} disabled={busy || maintaining || collectionBusy} onChange={(event) => { setProvider(event.target.value); setSelected(null); setResult(null); setQuery(null); setError(''); }}>{providers.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select><button type="button" disabled={busy || maintaining || collectionBusy} onClick={() => setSettingsOpen(true)}>Manage connections</button></>}</div><form onSubmit={submit}>
            <div className="source-field"><label htmlFor="content">{isCollections ? 'COLLECTION CONTENT' : isGallery ? 'GALLERY CONTENT' : `${source.name.toUpperCase()} CONTENT`}</label><select id="content" value={safeOnly ? 'safe' : 'all'} disabled={busy || maintaining || collectionBusy} onChange={(event) => {
              setSafeOnly(event.target.value === 'safe'); setResult(null); setQuery(null); setSelected(null); setError('');
            }}><option value="safe">Safe only · rating:{isGallery ? 's' : source.safeRating}</option><option value="all">All ratings</option></select></div>
            <TagSearch key={isGallery ? 'gallery' : provider} provider={provider} gallery={isGallery} value={tags} onChange={setTags} disabled={busy || maintaining || collectionBusy} inputRef={inputRef} />
            <button className="primary-button" disabled={busy || maintaining || collectionBusy || !library || (isGallery && !library.root) || (isCollections && collectionId === null)} type="submit">{busy ? 'Searching…' : 'Search'} <span aria-hidden="true">↗</span></button>
          </form>
          <div className="search-bottom"><p id="search-help">{isGallery ? 'Local exact tags, -exclusions, artist:tag, provider:site-id, rating:s/q/e, source:text and type:png/webm.' : <>Separate tags with spaces. Use <code>_</code> in a tag and <code>-tag</code> to exclude.</>}</p><div className="suggestions"><span>TRY</span>{['forest', 'illustration', `rating:${isGallery ? 's' : source.engine === 'gelbooru' && source.safeRating === 'g' ? 'general' : source.safeRating}`].map((tag) => <button key={tag} disabled={busy} onClick={() => suggest(tag)}>{tag}</button>)}</div></div>
        </section>
        {error && <div role="alert" className="error-message">{error}{result && ' Your previous results are still shown.'}</div>}
        <section className="results-section" aria-label="Search results" aria-busy={busy}>
          <div className="results-heading"><div><h2>{isCollections ? collections.find((item) => item.id === collectionId)?.name ?? 'Choose a collection' : isGallery ? 'Saved media' : query ? 'Results' : 'Search results'}</h2><p role="status" aria-live="polite">{busy ? 'Searching the selected source…' : result && query ? `${result.posts.length} posts loaded · page ${result.page} · ${isGallery ? 'local archive' : providers.find((entry) => entry.id === query.provider)?.name ?? query.provider} · ${query.tags || 'all tags'}` : 'Choose a source and search to begin.'}</p></div>
            <button disabled={!preferencesReady || preferencesBusy} aria-label="Toggle grid layout" onClick={() => void savePreferences({ ...preferences, gridMode: preferences.gridMode === 'natural' ? 'crop' : 'natural' })}>{preferences.gridMode === 'natural' ? 'Crop grid' : 'Original proportions'}</button><span className="results-label">{(query?.safeOnly ?? safeOnly) ? 'SAFE ONLY' : 'ALL RATINGS'} · {isGallery ? 'ARCHIVE' : source.name.toUpperCase()}</span></div>
          {result && result.posts.length > 0 ? <PostGrid key={galleryRevision} posts={result.posts} mode={preferences.gridMode} busy={busy || maintaining || collectionBusy} onSelect={setSelected} /> : <div className="empty-state"><span className="empty-leaf"><Leaf /></span><h3>{result ? 'No posts found' : isCollections ? 'Your offline collections' : isGallery ? 'Your offline archive' : 'Follow your curiosity'}</h3><p>{isCollections ? 'Add saved media from Gallery → post details → Manage collections.' : isGallery ? 'Download originals from Discover, or import Foliuna sidecars.' : result ? 'Try fewer tags, a different spelling, or another source.' : 'Enter tags above to get started.'}</p>{!result && !isGallery && <button className="text-button" disabled={busy} onClick={() => suggest('forest')}>Start with “forest” <span aria-hidden="true">→</span></button>}</div>}
          {result && query && (preferences.browsing === 'pages' ? <div className="pagination"><p>Page {result.page} <span>· up to 24 posts per page</span></p><div><button disabled={busy || result.page <= 1} onClick={() => void search({ ...query, page: result.page - 1 })}>← Previous</button><button disabled={busy || !result.hasMore || (!isGallery && result.page >= MAX_PAGE)} onClick={() => void search({ ...query, page: result.page + 1 })}>Next →</button></div></div> :
            <div className="pagination" ref={sentinel}><p>{result.posts.length} posts loaded · page {result.page}</p><button disabled={busy || !result.hasMore} onClick={() => void search({ ...query, page: result.page + 1 }, true)}>{busy ? 'Loading more…' : result.hasMore ? 'Load more posts' : 'End of results'}</button></div>)}
        </section>
        <footer className="main-footer"><span><span className="status-dot" /> {isGallery ? 'Available locally. No provider requests.' : library?.demo ? 'Local fixtures. Zero network requests.' : 'Downloads start only when you choose.'}</span></footer>
      </main>
    </div>
    {selected && <PostDetails selected={selected} safeOnly={query?.safeOnly !== false} demo={library?.demo ?? false} libraryReady={Boolean(library?.root)} downloading={downloading} message={downloadMessage} downloadError={downloadError} onDownload={download} onCancelDownload={cancelDownload} onClose={() => setSelected(null)} navigationError={error} busy={busy || maintaining || collectionBusy} position={`${selectedIndex + 1} of ${result?.posts.length ?? 0} loaded`}
      onPrevious={selectedIndex > 0 ? () => setSelected(result!.posts[selectedIndex - 1]) : undefined}
      onNext={result && (selectedIndex < result.posts.length - 1 || result.hasMore) ? () => void nextPost() : undefined}
      onCollections={(post) => { setMembershipChanged(false); setCollectPost(post); }} onTag={tagAction} favoriteTags={preferences.favoriteTags} onFavorite={favorite} />}
    {collectPost && <CollectionDialog key={collectPost.archive?.sha256} post={collectPost} onChanged={() => setMembershipChanged(true)} onClose={() => { setCollectPost(null); if (membershipChanged && isCollections) { setSelected(null); void openCollections(collectionId); } }} />}
    {accountOpen && <AccountDialog preferences={preferences} onClose={() => setAccountOpen(false)} onRemove={favorite} onSearch={(value, site = provider) => { setAccountOpen(false); setView('discover'); setProvider(site); setTags(value); void search({ provider: site, tags: value, page: 1, safeOnly }, false, 'discover'); }} />}
    {settingsOpen && <SettingsDialog onProviders={updateProviders} preferencesBusy={preferencesBusy} preferences={preferences} onPreferences={savePreferences} downloading={downloading} onClose={() => { setSettingsOpen(false); if (isCollections) { void openCollections(); } else if (isGallery) { setGalleryRevision((value) => value + 1); void search({ provider: 'e621', tags, page: 1, safeOnly }); } }} onLibrary={(value) => { if (value.root !== library?.root) { setCollectionId(null); setCollections([]); setResult(null); setQuery(null); setSelected(null); } setLibrary(value); }} />}
  </div>;
}
