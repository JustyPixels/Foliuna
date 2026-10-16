// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/App';
import { DemoAdapter } from '../src/main/adapters/demo';
import type { FoliunaApi, Result, SearchResult } from '../src/shared/contracts';

const demo = new DemoAdapter('e621');
const search = vi.fn<FoliunaApi['search']>();
const getPost = vi.fn<FoliunaApi['getPost']>();
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  search.mockReset().mockImplementation(async (request) => ({ ok: true, value: await demo.search(request) }));
  getPost.mockReset().mockImplementation(async (request) => ({ ok: true, value: await demo.getPost(request.id) }));
  window.foliuna = { search, getPost,
    libraryStatus: vi.fn().mockResolvedValue({ ok: true, value: { assets: 0, schemaVersion: 2, demo: true, root: null, issue: null } }),
    openPost: vi.fn().mockResolvedValue({ ok: true, value: null }),
    getSettings: vi.fn().mockResolvedValue({ ok: true, value: { encryptionAvailable: true, credentials: [
      { provider: 'e621', saved: false, username: null, locked: false },
    ], library: { assets: 0, schemaVersion: 2, demo: true, root: null, issue: null } } }),
    saveCredentials: vi.fn().mockResolvedValue({ ok: true, value: { provider: 'e621', saved: true, username: 'test_user', locked: false } }),
    removeCredentials: vi.fn().mockResolvedValue({ ok: true, value: null }),
    saveProvider: vi.fn(),
    removeProvider: vi.fn().mockResolvedValue({ ok: true, value: null }),
    testConnection: vi.fn().mockResolvedValue({ ok: true, value: null }),
    chooseLibrary: vi.fn().mockResolvedValue({ ok: true, value: { assets: 0, schemaVersion: 2, demo: true, root: null, issue: null } }),
    downloadPost: vi.fn().mockResolvedValue({ ok: true, value: { sha256: 'a'.repeat(64), duplicate: false, relativePath: 'media/a.png' } }),
    cancelDownload: vi.fn().mockResolvedValue({ ok: true, value: null }),
    getPreferences: vi.fn().mockResolvedValue({ ok: true, value: { gridMode: 'natural', browsing: 'pages', favoriteTags: [] } }),
    savePreferences: vi.fn().mockImplementation(async (value) => ({ ok: true, value })),
    suggestTags: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    getAccount: vi.fn().mockResolvedValue({ ok: false, error: { code: 'CREDENTIALS_REQUIRED', message: 'Save credentials in Settings first.' } }),
    gallerySearch: vi.fn().mockResolvedValue({ ok: true, value: { posts: [], page: 1, hasMore: false } }),
    galleryPost: vi.fn(),
    galleryTags: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    importSidecars: vi.fn(),
    reconcileLibrary: vi.fn(),
    collectionList: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    collectionCreate: vi.fn(),
    collectionRename: vi.fn(),
    collectionDelete: vi.fn(),
    collectionMembership: vi.fn(),
    cacheThumbnail: vi.fn().mockResolvedValue({ ok: true, value: null }),
    openViewer: vi.fn().mockResolvedValue({ ok: true, value: null }),
  };
});
afterEach(cleanup);
async function ready() { render(<App />); await screen.findByText('LOCAL DEMO'); return userEvent.setup(); }
async function findForest(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('SEARCH TAGS'), 'forest');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('button', { name: 'View post 1001' });
}

describe('search interface', () => {
  it('starts safely on e621 without issuing an automatic provider search', async () => {
    await ready();
    expect(screen.getByLabelText('E621 CONTENT')).toHaveValue('safe');
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText('Library ready · 0 saved')).toBeInTheDocument();
  });
  it('searches, paginates the submitted query even after draft edits, and disables Next on the final page', async () => {
    const user = await ready(); await findForest(user);
    expect(screen.getAllByRole('button', { name: /^View post/ })).toHaveLength(24);
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
    await user.type(screen.getByLabelText('SEARCH TAGS'), ' fox');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await screen.findByRole('button', { name: 'View post 1025' });
    expect(search).toHaveBeenLastCalledWith({ provider: 'e621', tags: 'forest', page: 2, safeOnly: true });
    expect(screen.getAllByRole('button', { name: /^View post/ })).toHaveLength(6);
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Previous/ }));
    await screen.findByRole('button', { name: 'View post 1001' });
  });
  it('deduplicates suggestions and clears results when the content filter changes', async () => {
    const user = await ready();
    await user.click(screen.getByRole('button', { name: 'forest' }));
    await user.click(screen.getByRole('button', { name: 'forest' }));
    expect(screen.getByLabelText('SEARCH TAGS')).toHaveValue('forest');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByRole('button', { name: 'View post 1001' });
    await user.selectOptions(screen.getByLabelText('E621 CONTENT'), 'all');
    expect(screen.queryByRole('button', { name: 'View post 1001' })).not.toBeInTheDocument();
    expect(screen.getByText('Follow your curiosity')).toBeInTheDocument();
  });
  it('shows empty results and preserves a previous page when a later request fails', async () => {
    const user = await ready(); await findForest(user);
    search.mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK', message: 'Connection unavailable.' } });
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('previous results are still shown');
    expect(screen.getByRole('button', { name: 'View post 1001' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('SEARCH TAGS'));
    await user.type(screen.getByLabelText('SEARCH TAGS'), 'no_such_tag');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('No posts found');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('prevents repeated requests while a search is pending', async () => {
    const user = await ready();
    let finish!: (value: Result<SearchResult>) => void;
    search.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('button', { name: 'Searching…' })).toBeDisabled();
    expect(screen.getByLabelText('E621 CONTENT')).toBeDisabled();
    finish({ ok: true, value: { posts: [], page: 1, hasMore: false } });
    await screen.findByText('No posts found');
    expect(search).toHaveBeenCalledTimes(1);
  });
  it('fetches details, renders remote text without HTML, and closes the dialog', async () => {
    const user = await ready(); await findForest(user);
    const post = await demo.getPost(1001);
    getPost.mockResolvedValueOnce({ ok: true, value: { ...post, description: '<script>window.compromised=true</script>' } });
    await user.click(screen.getByRole('button', { name: 'View post 1001' }));
    expect(await screen.findByRole('dialog', { name: 'Post #1001' })).toBeInTheDocument();
    await screen.findByText('Categorized tags');
    expect(screen.getByText('<script>window.compromised=true</script>')).toBeInTheDocument();
    expect(document.querySelector('dialog script')).toBeNull();
    expect(screen.getByRole('button', { name: 'Fictional demo post' })).toBeDisabled();
    expect(getPost).toHaveBeenCalledWith({ provider: 'e621', id: 1001 });
    await user.click(screen.getByRole('button', { name: 'Close post details' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View post 1001' })).toHaveFocus();
  });
  it('supports retrying failed details and reports bridge failures without crashing', async () => {
    const user = await ready(); await findForest(user);
    getPost.mockRejectedValueOnce(new Error('IPC closed'));
    await user.click(screen.getByRole('button', { name: 'View post 1001' }));
    await screen.findByText('Could not load post details. Please try again.');
    await user.click(screen.getByRole('button', { name: 'Retry details' }));
    await screen.findByText('Categorized tags');
    expect(getPost).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Close post details' }));
    search.mockRejectedValueOnce(new Error('IPC closed'));
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not complete the search'));
  });
  it('does not display media if a safe search result is re-rated before opening details', async () => {
    const user = await ready(); await findForest(user);
    getPost.mockResolvedValueOnce({ ok: true, value: { ...await demo.getPost(1001), rating: 'e' } });
    await user.click(screen.getByRole('button', { name: 'View post 1001' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer rated safe');
    expect(document.querySelector('dialog img')).toBeNull();
  });
});

describe('settings and explicit archive actions', () => {
  it('clears the API key on submit and closing settings, with no saved-key readback', async () => {
    const user = await ready();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByLabelText('API key');
    await user.type(screen.getByLabelText('Site username'), 'test_user');
    await user.type(screen.getByLabelText('API key'), 'fictional_test_key');
    await user.click(screen.getByRole('button', { name: 'Save credentials' }));
    expect(window.foliuna.saveCredentials).toHaveBeenCalledWith({ provider: 'e621', username: 'test_user', apiKey: 'fictional_test_key' });
    expect(screen.getByLabelText('API key')).toHaveValue('');
    await screen.findByText(/Credentials encrypted and saved/);
    await user.type(screen.getByLabelText('API key'), 'another_fictional_key');
    await user.click(screen.getByRole('button', { name: 'Close settings' }));
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByLabelText('API key');
    expect(screen.getByLabelText('API key')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Close settings' }));
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
  });
  it('refuses credential entry when secure encryption is unavailable', async () => {
    const user = await ready();
    const original = await window.foliuna.getSettings();
    if (!original.ok) throw new Error();
    vi.mocked(window.foliuna.getSettings).mockResolvedValue({ ok: true, value: { ...original.value, encryptionAvailable: false } });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByText(/will not save credentials in plaintext/);
    expect(screen.getByLabelText('API key')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save credentials' })).toBeDisabled();
  });
  it('tests and removes the selected account and displays provider denial without exposing a key', async () => {
    const user = await ready();
    const original = await window.foliuna.getSettings(); if (!original.ok) throw new Error();
    vi.mocked(window.foliuna.getSettings).mockResolvedValue({ ok: true, value: { ...original.value,
      library: { ...original.value.library, demo: false },
      credentials: [{ provider: 'e621', saved: true, username: 'fixture_user', locked: false }],
    } });
    vi.mocked(window.foliuna.testConnection).mockResolvedValueOnce({ ok: false, error: { code: 'HTTP_403', message: 'The provider denied access (HTTP 403).' } });
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByText(/Encrypted entry saved for fixture_user/);
    expect(screen.getByLabelText('API key')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 403');
    expect(window.foliuna.testConnection).toHaveBeenCalledWith('e621');
    await user.click(screen.getByRole('button', { name: 'Remove credentials' }));
    await screen.findByText(/Saved credentials removed/);
    expect(window.foliuna.removeCredentials).toHaveBeenCalledWith('e621');
  });
  it('downloads only after a click and refreshes the library count on completion', async () => {
    const original = await window.foliuna.libraryStatus(); if (!original.ok) throw new Error();
    vi.mocked(window.foliuna.libraryStatus).mockResolvedValue({ ok: true, value: { ...original.value, demo: false, root: 'C:/fixture-archive' } });
    const user = await readyLive();
    await findForest(user);
    const post = await demo.getPost(1001);
    getPost.mockResolvedValueOnce({ ok: true, value: { ...post, file: { ...post.file, url: 'https://static1.e621.net/data/original.png' } } });
    await user.click(screen.getByRole('button', { name: 'View post 1001' }));
    await screen.findByRole('button', { name: 'Download original' });
    expect(window.foliuna.downloadPost).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Download original' }));
    await screen.findAllByText(/Saved to archive with tags and source metadata/);
    expect(window.foliuna.downloadPost).toHaveBeenCalledWith({ provider: 'e621', id: 1001 });
    expect(window.foliuna.libraryStatus).toHaveBeenCalledTimes(3);
  });
  it('sends cancellation for a pending transfer and surfaces download failures', async () => {
    const original = await window.foliuna.libraryStatus(); if (!original.ok) throw new Error();
    vi.mocked(window.foliuna.libraryStatus).mockResolvedValue({ ok: true, value: { ...original.value, demo: false, root: 'C:/fixture-archive' } });
    const user = await readyLive(); await findForest(user);
    const post = await demo.getPost(1001);
    getPost.mockResolvedValueOnce({ ok: true, value: { ...post, file: { ...post.file, url: 'https://static1.e621.net/data/original.png' } } });
    let finish!: (response: Awaited<ReturnType<FoliunaApi['downloadPost']>>) => void;
    vi.mocked(window.foliuna.downloadPost).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await user.click(screen.getByRole('button', { name: 'View post 1001' }));
    await user.click(await screen.findByRole('button', { name: 'Download original' }));
    expect(screen.getByRole('button', { name: 'Archiving…' })).toBeDisabled();
    await user.click(screen.getAllByRole('button', { name: 'Cancel download' }).at(-1)!);
    expect(window.foliuna.cancelDownload).toHaveBeenCalledTimes(1);
    finish({ ok: false, error: { code: 'CANCELLED', message: 'Download cancelled.' } });
    await screen.findAllByText('Download cancelled.');
  });
  it('opens the sample first and fetches the full image only when selected, with visible errors and retry', async () => {
    const user = await ready(); await findForest(user);
    const post = await demo.getPost(1001);
    getPost.mockResolvedValueOnce({ ok: true, value: { ...post, previewUrl: '/preview.png', sampleUrl: '/sample.png', originalUrl: '/original.png' } });
    await user.click(screen.getByRole('button', { name: 'View post 1001' }));
    expect(await screen.findByAltText('Sample of post 1001')).toHaveAttribute('src', '/sample.png');
    expect(document.querySelector('img[src="/original.png"]')).toBeNull();
    await user.selectOptions(screen.getByLabelText('Image size'), 'original');
    const full = screen.getByAltText('Full-size image of post 1001');
    expect(full).toHaveAttribute('src', '/original.png');
    fireEvent.error(full);
    expect(screen.getByText('Image could not load.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry image' }));
    expect(screen.getByAltText('Full-size image of post 1001')).toHaveAttribute('src', '/original.png');
    await user.selectOptions(screen.getByLabelText('Image size'), 'sample');
    fireEvent.error(screen.getByAltText('Sample of post 1001'));
    expect(screen.getByAltText('Sample of post 1001')).toHaveAttribute('src', '/preview.png');
  });
});

async function readyLive() { render(<App />); await screen.findByText('LIVE SEARCH'); return userEvent.setup(); }

describe('extended browsing controls', () => {
  it('keeps one dialog open across posts and fetches the next page at the boundary', async () => {
    const user = await ready(); await findForest(user);
    await user.click(screen.getByRole('button', { name: 'View post 1024' }));
    const dialog = await screen.findByRole('dialog', { name: 'Post #1024' }); await screen.findByText('Categorized tags');
    await user.click(screen.getByRole('button', { name: 'Next post →' }));
    expect(await screen.findByRole('dialog', { name: 'Post #1025' })).toBe(dialog);
    expect(search).toHaveBeenLastCalledWith({ provider: 'e621', tags: 'forest', page: 2, safeOnly: true });
    await screen.findByText('Categorized tags');
    await user.click(screen.getByRole('button', { name: '← Previous post' }));
    expect(await screen.findByRole('dialog', { name: 'Post #1024' })).toBe(dialog);
  });
  it('appends once in infinite mode, keeps failed loads retryable, and retains the submitted query', async () => {
    vi.mocked(window.foliuna.getPreferences).mockResolvedValue({ ok: true, value: { gridMode: 'crop', browsing: 'infinite', favoriteTags: [] } });
    const user = await ready(); await findForest(user);
    await user.type(screen.getByLabelText('SEARCH TAGS'), ' changed');
    search.mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMIT', message: 'Provider paused.' } });
    await user.click(screen.getByRole('button', { name: 'Load more posts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Provider paused');
    expect(screen.getAllByRole('button', { name: /^View post/ })).toHaveLength(24);
    await user.click(screen.getByRole('button', { name: 'Load more posts' }));
    await screen.findByRole('button', { name: 'View post 1030' });
    expect(screen.getAllByRole('button', { name: /^View post/ })).toHaveLength(30);
    expect(search).toHaveBeenLastCalledWith({ provider: 'e621', tags: 'forest', page: 2, safeOnly: true });
    expect(screen.getByRole('button', { name: 'End of results' })).toBeDisabled();
  });
  it('deduplicates overlapping pages and repeated items within one response', async () => {
    vi.mocked(window.foliuna.getPreferences).mockResolvedValue({ ok: true, value: { gridMode: 'crop', browsing: 'infinite', favoriteTags: [] } });
    const user = await ready(); await findForest(user);
    const old = await demo.getPost(1001), fresh = await demo.getPost(1025);
    search.mockResolvedValueOnce({ ok: true, value: { posts: [old, fresh, fresh], page: 2, hasMore: true } });
    await user.click(screen.getByRole('button', { name: 'Load more posts' }));
    await screen.findByRole('button', { name: 'View post 1025' });
    expect(screen.getAllByRole('button', { name: /^View post/ })).toHaveLength(25);
    search.mockResolvedValueOnce({ ok: true, value: { posts: [old], page: 3, hasMore: true } });
    await user.click(screen.getByRole('button', { name: 'Load more posts' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No new posts were returned');
  });
  it('favorites an artist locally, adds/excludes tags without searching, and opens a scoped media window', async () => {
    const user = await ready(); await findForest(user);
    await user.click(screen.getByRole('button', { name: 'View post 1001' })); await screen.findByText('Categorized tags');
    await user.click(screen.getByRole('button', { name: 'Open media window ↗' }));
    expect(window.foliuna.openViewer).toHaveBeenCalledWith({ provider: 'e621', id: 1001, size: 'sample' });
    await user.click(screen.getByRole('button', { name: 'Tag foliuna_demo' }));
    await user.click(screen.getByRole('menuitem', { name: 'Favorite tag' }));
    expect(window.foliuna.savePreferences).toHaveBeenCalledWith({ gridMode: 'natural', browsing: 'pages', favoriteTags: ['foliuna_demo'] });
    await user.click(screen.getByRole('button', { name: 'Tag fox' }));
    await user.click(screen.getByRole('menuitem', { name: 'Exclude from search' }));
    await waitFor(() => expect(screen.getByLabelText('SEARCH TAGS')).toHaveFocus());
    expect(screen.getByLabelText('SEARCH TAGS')).toHaveValue('forest -fox'); expect(search).toHaveBeenCalledTimes(1);
  });
});


it('switches booru sources and carries the submitted source through pagination', async () => {
  search.mockImplementation(async (request) => ({ ok: true, value: await new DemoAdapter(request.provider).search(request) }));
  const user = await ready();
  await user.selectOptions(screen.getByLabelText('Booru source'), 'safebooru');
  await user.type(screen.getByLabelText('SEARCH TAGS'), 'forest');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(search).toHaveBeenLastCalledWith({ provider: 'safebooru', tags: 'forest', page: 1, safeOnly: true });
  await user.click(screen.getByRole('button', { name: /Next →/ }));
  expect(search).toHaveBeenLastCalledWith({ provider: 'safebooru', tags: 'forest', page: 2, safeOnly: true });
  await user.selectOptions(screen.getByLabelText('Booru source'), 'danbooru');
  expect(screen.queryByRole('button', { name: /^View post/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('DANBOORU CONTENT')).toHaveTextContent('rating:g');
});

it('uses numeric API user IDs for Rule34 and clears transient keys when changing connections', async () => {
  const user = await ready(); await user.click(screen.getByRole('button', { name: 'Settings' }));
  await screen.findByLabelText('Connection');
  await user.type(screen.getByLabelText('API key', { exact: true }), 'DISCARD_ME');
  await user.selectOptions(screen.getByLabelText('Connection'), 'rule34');
  expect(screen.getByLabelText('API key', { exact: true })).toHaveValue('');
  await user.type(screen.getByLabelText('Numeric user ID'), '123');
  await user.type(screen.getByLabelText('API key', { exact: true }), 'FICTIONAL_RULE34_KEY');
  await user.click(screen.getByRole('button', { name: 'Save credentials' }));
  expect(window.foliuna.saveCredentials).toHaveBeenCalledWith({ provider: 'rule34', username: '123', apiKey: 'FICTIONAL_RULE34_KEY' });
  expect(screen.getByLabelText('API key', { exact: true })).toHaveValue('');
});

it('keeps collection scope through filters and pagination and clears it when returning to Gallery', async () => {
  vi.mocked(window.foliuna.libraryStatus).mockResolvedValue({ ok:true, value:{assets:2,schemaVersion:3,demo:true,root:'C:/fixture',issue:null} });
  vi.mocked(window.foliuna.collectionList).mockResolvedValue({ok:true,value:[{id:1,name:'Favorites',assets:2,pending:0}]});
  vi.mocked(window.foliuna.gallerySearch).mockImplementation(async (request)=>({ok:true,value:{posts:[],page:request.page,hasMore:request.page===1}}));
  const user=await ready(); await user.click(screen.getByRole('button',{name:'Collections'}));
  await waitFor(()=>expect(window.foliuna.gallerySearch).toHaveBeenLastCalledWith({tags:'',page:1,safeOnly:true,collectionId:1}));
  await user.type(screen.getByLabelText('SEARCH TAGS'),'forest'); await user.click(screen.getByRole('button',{name:'Search'}));
  await user.click(screen.getByRole('button',{name:'Next →'}));
  expect(window.foliuna.gallerySearch).toHaveBeenLastCalledWith({tags:'forest',page:2,safeOnly:true,collectionId:1});
  await user.click(screen.getByRole('button',{name:'Gallery'}));
  expect(window.foliuna.gallerySearch).toHaveBeenLastCalledWith({tags:'',page:1,safeOnly:true});
  expect(search).not.toHaveBeenCalled();
});

it('adds archived media to collections and leaves membership unchanged on a save failure', async () => {
  const post={...await demo.getPost(1001),archive:{sha256:'a'.repeat(64),capturedAt:'2026-10-16',sourceCount:1,missing:false,provenance:[{provider:'e621',id:1001}]}};
  vi.mocked(window.foliuna.libraryStatus).mockResolvedValue({ok:true,value:{assets:1,schemaVersion:3,demo:true,root:'C:/fixture',issue:null}});
  vi.mocked(window.foliuna.gallerySearch).mockResolvedValue({ok:true,value:{posts:[post],page:1,hasMore:false}});
  vi.mocked(window.foliuna.galleryPost).mockResolvedValue({ok:true,value:post});
  vi.mocked(window.foliuna.collectionList).mockResolvedValue({ok:true,value:[{id:1,name:'Favorites',assets:0,pending:0,contains:false}]});
  vi.mocked(window.foliuna.collectionMembership).mockResolvedValueOnce({ok:false,error:{code:'COLLECTIONS_WRITE',message:'Not saved; retry.'}}).mockResolvedValueOnce({ok:true,value:[{id:1,name:'Favorites',assets:1,pending:0}]});
  const user=await ready();await user.click(screen.getByRole('button',{name:'Gallery'}));await user.click(await screen.findByRole('button',{name:'View post 1001'}));
  await user.click(await screen.findByRole('button',{name:'Manage collections'}));
  const checkbox=await screen.findByRole('checkbox',{name:/Favorites/});await user.click(checkbox);
  expect(await screen.findByRole('alert')).toHaveTextContent('Not saved'); expect(checkbox).not.toBeChecked();
  await user.click(checkbox);await waitFor(()=>expect(checkbox).toBeChecked());
  expect(window.foliuna.collectionMembership).toHaveBeenLastCalledWith({id:1,sha256:'a'.repeat(64),present:true});
  await user.click(screen.getByRole('button',{name:'Done'})); expect(screen.getByRole('dialog',{name:'Post #1001'})).toBeInTheDocument();
  expect(window.foliuna.downloadPost).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled();
});
