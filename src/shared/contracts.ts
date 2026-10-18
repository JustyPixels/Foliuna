export const PROVIDERS = ['e926', 'e621', 'danbooru', 'gelbooru', 'rule34', 'safebooru', 'aibooru', 'yandere', 'konachan'] as const;
export type Provider = string;
export interface ProviderDefinition {
  id: Provider; name: string; engine: 'e621' | 'danbooru' | 'gelbooru' | 'moebooru';
  baseUrl: string; apiUrl: string; auth: 'basic' | 'query' | 'none'; safeRating: 's' | 'g'; mediaOrigins: string[];
}
export const TAG_CATEGORIES = ['artist', 'copyright', 'character', 'species', 'general', 'meta', 'lore', 'invalid'] as const;
export type TagCategory = typeof TAG_CATEGORIES[number];
export type CategorizedTags = Record<TagCategory, string[]>;
export const PAGE_SIZE = 24;
export const MAX_PAGE = 750;

export interface SearchRequest { provider: Provider; tags: string; page: number; safeOnly?: boolean }
export interface PostRequest { provider: Provider; id: number }
export interface Post {
  provider: Provider;
  id: number;
  rating: 's' | 'q' | 'e';
  tags: CategorizedTags;
  description: string;
  sources: string[];
  createdAt: string | null;
  score: number;
  favorites: number;
  file: { url: string | null; extension: string; width: number; height: number; size: number; md5: string | null };
  previewUrl: string | null;
  sampleUrl: string | null;
  originalUrl: string | null;
  unavailable: boolean;
  source?: ProviderDefinition;
  sourceRating?: string;
  archive?: { sha256: string; capturedAt: string; sourceCount: number; missing: boolean; provenance: { provider: Provider; id: number }[] };
}
export interface SearchResult { posts: Post[]; page: number; hasMore: boolean }
export interface LibraryStatus { assets: number; schemaVersion: number; demo: boolean; root: string | null; issue: string | null }
export interface CredentialInput { provider: Provider; username: string; apiKey: string }
export interface CredentialStatus { provider: Provider; saved: boolean; username: string | null; locked: boolean }
export interface Settings { encryptionAvailable: boolean; credentials: CredentialStatus[]; library: LibraryStatus; providers?: ProviderDefinition[] }
export interface ArchiveResult { sha256: string; relativePath: string; duplicate: boolean }
export interface Preferences { gridMode: 'crop' | 'natural'; browsing: 'pages' | 'infinite'; favoriteTags: string[] }
export const DEFAULT_PREFERENCES: Preferences = { gridMode: 'natural', browsing: 'pages', favoriteTags: [] };
export interface TagSuggestion { name: string; category: number; count: number; recent?: boolean }
export interface Account { id: number; name: string; level: string; joined: string | null; favorites: number; uploads: number; favoriteTags: string[] }
export type ViewerRequest = (PostRequest | { archiveSha: string; source?: PostRequest }) & { size: 'sample' | 'original' };
export interface GalleryRequest { tags: string; page: number; safeOnly?: boolean; collectionId?: number }
export interface Collection { id: number; name: string; assets: number; pending: number; contains?: boolean }
export interface LibraryReport { checked: number; imported: number; recovered: number; missing: number; invalid: number; conflicts: number; issues: { file: string; message: string }[] }
export type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export interface PlatformCapabilities { name: 'windows' | 'android'; chooseLibrary: boolean; importSidecars: boolean; exportLibrary: boolean; floatingViewer: boolean; flash: boolean }
export const WINDOWS_CAPABILITIES: PlatformCapabilities = { name: 'windows', chooseLibrary: true, importSidecars: true, exportLibrary: false, floatingViewer: true, flash: true };

export interface FoliunaApi {
  platform(): Promise<Result<PlatformCapabilities>>;
  exportLibrary(): Promise<Result<{ exported: number; cancelled: boolean }>>;
  search(request: SearchRequest): Promise<Result<SearchResult>>;
  getPost(request: PostRequest): Promise<Result<Post>>;
  libraryStatus(): Promise<Result<LibraryStatus>>;
  openPost(request: PostRequest & { archiveSha?: string }): Promise<Result<null>>;
  getSettings(): Promise<Result<Settings>>;
  saveCredentials(input: CredentialInput): Promise<Result<CredentialStatus>>;
  removeCredentials(provider: Provider): Promise<Result<null>>;
  testConnection(provider: Provider): Promise<Result<null>>;
  saveProvider(input: Omit<ProviderDefinition, 'id'>): Promise<Result<ProviderDefinition>>;
  removeProvider(provider: Provider): Promise<Result<null>>;
  chooseLibrary(): Promise<Result<LibraryStatus>>;
  downloadPost(request: PostRequest): Promise<Result<ArchiveResult>>;
  cancelDownload(): Promise<Result<null>>;
  getPreferences(): Promise<Result<Preferences>>;
  savePreferences(input: Preferences): Promise<Result<Preferences>>;
  suggestTags(prefix: string | { provider: Provider; prefix: string }): Promise<Result<TagSuggestion[]>>;
  getAccount(): Promise<Result<Account>>;
  openViewer(input: ViewerRequest): Promise<Result<null>>;
  gallerySearch(input: GalleryRequest): Promise<Result<SearchResult>>;
  galleryPost(input: PostRequest & { sha256: string }): Promise<Result<Post>>;
  galleryTags(prefix: string): Promise<Result<TagSuggestion[]>>;
  importSidecars(): Promise<Result<LibraryReport>>;
  reconcileLibrary(): Promise<Result<LibraryReport>>;
  cacheThumbnail(input: { sha256: string; png: Uint8Array }): Promise<Result<null>>;
  collectionList(input?: { sha256: string }): Promise<Result<Collection[]>>;
  collectionCreate(input: { name: string }): Promise<Result<Collection[]>>;
  collectionRename(input: { id: number; name: string }): Promise<Result<Collection[]>>;
  collectionDelete(id: number): Promise<Result<Collection[]>>;
  collectionMembership(input: { id: number; sha256: string; present: boolean }): Promise<Result<Collection[]>>;
}

export const CHANNELS = {
  platform: 'foliuna:platform',
  exportLibrary: 'foliuna:export-library',
  search: 'foliuna:search',
  getPost: 'foliuna:get-post',
  libraryStatus: 'foliuna:library-status',
  openPost: 'foliuna:open-post',
  getSettings: 'foliuna:get-settings',
  saveCredentials: 'foliuna:save-credentials',
  removeCredentials: 'foliuna:remove-credentials',
  testConnection: 'foliuna:test-connection',
  saveProvider: 'foliuna:save-provider',
  removeProvider: 'foliuna:remove-provider',
  chooseLibrary: 'foliuna:choose-library',
  downloadPost: 'foliuna:download-post',
  cancelDownload: 'foliuna:cancel-download',
  getPreferences: 'foliuna:get-preferences',
  savePreferences: 'foliuna:save-preferences',
  suggestTags: 'foliuna:suggest-tags',
  getAccount: 'foliuna:get-account',
  openViewer: 'foliuna:open-viewer',
  gallerySearch: 'foliuna:gallery-search',
  galleryPost: 'foliuna:gallery-post',
  galleryTags: 'foliuna:gallery-tags',
  importSidecars: 'foliuna:import-sidecars',
  reconcileLibrary: 'foliuna:reconcile-library',
  cacheThumbnail: 'foliuna:cache-thumbnail',
  collectionList: 'foliuna:collection-list',
  collectionCreate: 'foliuna:collection-create',
  collectionRename: 'foliuna:collection-rename',
  collectionDelete: 'foliuna:collection-delete',
  collectionMembership: 'foliuna:collection-membership',
} as const;
