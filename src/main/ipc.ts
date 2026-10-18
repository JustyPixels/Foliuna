import { CHANNELS, WINDOWS_CAPABILITIES, type Result, type ViewerRequest, type Account } from '../shared/contracts';
import { AppError, postRequest, postUrl, provider, record, searchRequest } from '../shared/validation';
import type { BooruAdapter } from './adapters/types';
import type { Provider } from '../shared/contracts';
import { isTrustedSender, type SenderIdentity } from './security';
import type { CredentialStore } from './credentials';
import type { ArchiveLibrary } from './archive/library';
import type { ApiClient } from './adapters/http';
import { PostMedia } from './media';
import type { PreferenceStore } from './preferences';
import { Gallery } from './archive/gallery';
import { sha256 } from './archive/local-files';
import { ProviderStore } from './providers';
import { BUILTIN_PROVIDERS, definitionFor } from '../shared/providers';
import { CompatibleAdapter } from './adapters/compatible';
import { Collections } from './archive/collections';

export async function respond<T>(sender: SenderIdentity, action: () => T | Promise<T>): Promise<Result<T>> {
  if (!isTrustedSender(sender)) return { ok: false, error: { code: 'FORBIDDEN', message: 'Untrusted app frame.' } };
  try { return { ok: true, value: await action() }; }
  catch (error) {
    return { ok: false, error: error instanceof AppError ? { code: error.code, message: error.message } :
      { code: 'INTERNAL', message: 'Foliuna could not complete this request. Please try again.' } };
  }
}

export interface Services {
  adapters: Partial<Record<Provider, BooruAdapter>>;
  library: ArchiveLibrary;
  credentials: CredentialStore;
  client: ApiClient;
  demo: boolean;
  openExternal(url: string): Promise<unknown>;
  selectDirectory(): Promise<string | null>;
  media?: PostMedia;
  preferences?: PreferenceStore;
  openViewer?(request: ViewerRequest): Promise<void>;
  providers?: ProviderStore;
  refreshProviders?(): void;
}

export function actions({ adapters, library, credentials, client, demo, openExternal, selectDirectory, media = new PostMedia(), preferences, openViewer, providers, refreshProviders }: Services) {
  const gallery = new Gallery(library);
  const collections = new Collections(library);
  const definitions = () => providers?.list() ?? BUILTIN_PROVIDERS;
  const definition = (id: string) => providers ? providers.get(id) : definitionFor(id);
  return {
    [CHANNELS.platform]: () => WINDOWS_CAPABILITIES,
    [CHANNELS.exportLibrary]: () => { throw new AppError('UNSUPPORTED', 'On Windows, back up the complete archive folder.'); },
    [CHANNELS.search]: async (input: unknown) => {
      const request = searchRequest(input);
      const adapter = adapters[request.provider];
      if (!adapter) throw new AppError('INVALID_INPUT', 'Choose a configured booru in Discover.');
      const result = await adapter.search(request);
      return { ...result, posts: result.posts.map((post) => media.register(post)) };
    },
    [CHANNELS.getPost]: async (input: unknown) => {
      const request = postRequest(input);
      const adapter = adapters[request.provider];
      if (!adapter) throw new AppError('INVALID_INPUT', 'This booru is not configured.');
      return media.register(await adapter.getPost(request.id));
    },
    [CHANNELS.libraryStatus]: () => library.status(),
    [CHANNELS.openPost]: async (input: unknown) => {
      const request = postRequest(input);
      if (demo) throw new AppError('DEMO', 'Demo IDs are fictional. Switch to live mode to open source posts.');
      const archived = record(input).archiveSha;
      const source = archived === undefined ? definition(request.provider) : (await gallery.getPost(sha256(archived), request)).source;
      await openExternal(postUrl(request, source));
      return null;
    },
    [CHANNELS.getSettings]: async () => ({ encryptionAvailable: await credentials.available(), credentials: await credentials.statuses(definitions().map((entry) => entry.id)), library: library.status(), providers: definitions() }),
    [CHANNELS.saveProvider]: async (input: unknown) => {
      if (!providers || library.downloading) throw new AppError('BUSY', 'Wait for the library task before changing boorus.');
      const result = await providers.save(input); client.clearCache(); refreshProviders?.(); return result;
    },
    [CHANNELS.removeProvider]: async (input: unknown) => {
      const site = provider(input);
      if (!providers || library.downloading) throw new AppError('BUSY', 'Wait for the library task before changing boorus.');
      await providers.remove(site); await credentials.remove(site); client.clearCache(); refreshProviders?.(); return null;
    },
    [CHANNELS.saveCredentials]: async (input: unknown) => {
      const source = definition(provider(record(input).provider));
      if (source.auth === 'none') throw new AppError('INVALID_INPUT', 'This provider supports anonymous API reads only.');
      if (source.auth === 'query' && !/^[1-9]\d*$/.test(String(record(input).username))) throw new AppError('INVALID_INPUT', 'Enter the numeric user ID from this site’s API settings.');
      const status = await credentials.save(input); client.clearCache(); return status;
    },
    [CHANNELS.removeCredentials]: async (input: unknown) => { await credentials.remove(provider(input)); client.clearCache(); return null; },
    [CHANNELS.testConnection]: async (input: unknown) => {
      const site = provider(input);
      if (site === 'e926' || !adapters[site]) throw new AppError('INVALID_INPUT', 'Choose a configured live booru.');
      if (demo) throw new AppError('DEMO', 'Connection tests are disabled in the offline demo.');
      const source = definition(site);
      if (site === 'e621' && !await credentials.read(site)) throw new AppError('CREDENTIALS_REQUIRED', 'Save your username and API key for this provider first.');
      const url = new URL(source.engine === 'gelbooru' ? 'index.php' : source.engine === 'moebooru' ? 'post.json' : 'posts.json', source.apiUrl);
      url.search = new URLSearchParams({ ...(source.engine === 'gelbooru' ? { page: 'dapi', s: 'post', q: 'index', json: '1' } : {}), tags: `rating:${source.engine === 'gelbooru' && source.safeRating === 'g' ? 'general' : source.safeRating}`, limit: '1' }).toString();
      const response = await client.get(url, undefined, site);
      if (!Array.isArray(response) && !Array.isArray(record(response)[source.engine === 'e621' ? 'posts' : 'post'])) throw new AppError('INVALID_RESPONSE', 'The provider did not return a valid JSON post response.');
      return null;
    },
    [CHANNELS.chooseLibrary]: async () => {
      const path = await selectDirectory();
      return path ? library.select(path) : library.status();
    },
    [CHANNELS.downloadPost]: (input: unknown) => library.download(postRequest(input)),
    [CHANNELS.cancelDownload]: () => library.cancel(),
    [CHANNELS.getPreferences]: () => preferences!.get(),
    [CHANNELS.savePreferences]: (input: unknown) => preferences!.save(input),
    [CHANNELS.suggestTags]: async (input: unknown) => {
      const site = typeof input === 'string' ? 'e621' : provider(record(input).provider);
      input = typeof input === 'string' ? input : record(input).prefix;
      if (typeof input !== 'string' || input.length < 2 || input.length > 80 || /[\s*?%:\u0000-\u001f\u007f]/.test(input)) {
        throw new AppError('INVALID_INPUT', 'Use a tag prefix of 2–80 characters.');
      }
      if (demo) return ['forest', 'fox', 'foliuna_demo', 'wolf', 'deer', 'illustration'].filter((name) => name.startsWith(input.toLowerCase())).map((name) => ({ name, category: 0, count: 10 }));
      if (site !== 'e621') {
        const adapter = adapters[site];
        if (!(adapter instanceof CompatibleAdapter)) throw new AppError('INVALID_INPUT', 'This booru is not configured.');
        return adapter.suggestTags(input.toLowerCase());
      }
      const url = new URL('https://e621.net/tags.json');
      url.search = new URLSearchParams({ 'search[name_matches]': `${input.toLowerCase()}*`, 'search[order]': 'count', limit: '8' }).toString();
      const raw = await client.cached(url, 24 * 60 * 60 * 1000);
      if (!Array.isArray(raw) || raw.length > 8) throw new AppError('INVALID_RESPONSE', 'Invalid tag suggestions.');
      return raw.map((value) => {
        const tag = record(value);
        if (typeof tag.name !== 'string' || !tag.name || tag.name.length > 200 || /\s/.test(tag.name) ||
          !Number.isSafeInteger(tag.category) || !Number.isSafeInteger(tag.post_count) || Number(tag.post_count) < 0) throw new AppError('INVALID_RESPONSE', 'Invalid tag suggestion.');
        return { name: tag.name, category: Number(tag.category), count: Number(tag.post_count) };
      });
    },
    [CHANNELS.getAccount]: async (): Promise<Account> => {
      if (demo) throw new AppError('DEMO', 'Account access requires live mode.');
      if (!await credentials.read('e621')) throw new AppError('CREDENTIALS_REQUIRED', 'Save your e621 username and API key in Settings first.');
      const raw = record(await client.cached(new URL('https://e621.net/users/me.json')));
      if (typeof raw.name !== 'string' || typeof raw.level_string !== 'string') throw new AppError('INVALID_RESPONSE', 'Invalid account response.');
      const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
      // Deliberately exclude email, blacklist, private settings, API limits and all unknown fields.
      return { id: postRequest({ provider: 'e621', id: raw.id }).id, name: raw.name.slice(0, 100), level: raw.level_string.slice(0, 80),
        joined: typeof raw.created_at === 'string' ? raw.created_at : null, favorites: count(raw.favorite_count), uploads: count(raw.post_upload_count),
        favoriteTags: typeof raw.favorite_tags === 'string' ? raw.favorite_tags.split(/\s+/).filter((tag) => tag && tag.length <= 200).slice(0, 200) : [] };
    },
    [CHANNELS.openViewer]: async (input: unknown) => {
      const raw = record(input); const request = raw.archiveSha === undefined ? postRequest(input) : { archiveSha: sha256(raw.archiveSha), ...(raw.source === undefined ? {} : { source: postRequest(raw.source) }) };
      const size = raw.size;
      if (('provider' in request && !adapters[request.provider]) || !['sample', 'original'].includes(String(size))) throw new AppError('INVALID_INPUT', 'Choose a valid post and image size.');
      if (!openViewer) throw new AppError('UNAVAILABLE', 'The media window is unavailable.');
      await openViewer({ ...request, size: size as ViewerRequest['size'] }); return null;
    },
    [CHANNELS.gallerySearch]: (input: unknown) => gallery.search(input),
    [CHANNELS.galleryPost]: (input: unknown) => gallery.getPost(record(input).sha256, input),
    [CHANNELS.galleryTags]: (input: unknown) => gallery.tags(input),
    [CHANNELS.importSidecars]: () => gallery.importSidecars(),
    [CHANNELS.reconcileLibrary]: () => gallery.reconcile(),
    [CHANNELS.cacheThumbnail]: (input: unknown) => gallery.cacheThumbnail(input),
    [CHANNELS.collectionList]: (input: unknown) => collections.list(input),
    [CHANNELS.collectionCreate]: (input: unknown) => collections.create(input),
    [CHANNELS.collectionRename]: (input: unknown) => collections.rename(input),
    [CHANNELS.collectionDelete]: (input: unknown) => collections.remove(input),
    [CHANNELS.collectionMembership]: (input: unknown) => collections.membership(input),
  };
}
