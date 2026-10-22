import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { LibraryStatus, Result, Settings, Preferences, ProviderDefinition } from '../shared/contracts';
import { BUILTIN_PROVIDERS } from '../shared/providers';
import { useDialog } from './useDialog';
import { capabilities, isAndroid } from './platform';

export function SettingsDialog({ onClose, onLibrary, downloading, preferences, onPreferences, preferencesBusy, onProviders }: { onClose(): void; onLibrary(value: LibraryStatus): void; downloading: boolean; preferencesBusy: boolean; preferences: Preferences; onPreferences(value: Preferences): Promise<void>; onProviders?(value: ProviderDefinition[]): void }) {
  const ref = useDialog();
  const password = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [provider, setProvider] = useState('e621');
  const [engine, setEngine] = useState<'danbooru' | 'gelbooru'>('danbooru');
  const [editing, setEditing] = useState<ProviderDefinition | null>(null);
  const sources = settings?.providers ?? BUILTIN_PROVIDERS;
  const source = sources.find((entry) => entry.id === provider) ?? BUILTIN_PROVIDERS[0];
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const account = settings?.credentials.find((entry) => entry.provider === provider);

  useEffect(() => {
    let active = true;
    window.foliuna.getSettings().then((response) => {
      if (!active) return;
      if (response.ok) setSettings(response.value); else setError(response.error.message);
    }).catch(() => { if (active) setError('Could not load settings.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => { setUsername(account?.username ?? ''); if (password.current) password.current.value = ''; }, [account?.username, provider]);

  async function run(action: () => Promise<Result<unknown>>, success: string) {
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await action();
      if (!response.ok) { setError(response.error.message); return; }
      const refreshed = await window.foliuna.getSettings();
      if (refreshed.ok) { setSettings(refreshed.value); onLibrary(refreshed.value.library); onProviders?.(refreshed.value.providers ?? BUILTIN_PROVIDERS); }
      else { setError(refreshed.error.message); return; }
      setMessage(success);
    } catch { setError('Could not complete this settings action. Please try again.'); }
    finally { setBusy(false); }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const apiKey = password.current?.value ?? '';
    if (password.current) password.current.value = '';
    void run(() => window.foliuna.saveCredentials({ provider, username, apiKey }), 'Credentials encrypted and saved. Use Test connection to verify access.');
  }

  function saveCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const baseUrl = String(data.get('baseUrl') ?? '').trim();
    void run(async () => {
      const result = await window.foliuna.saveProvider({ name: String(data.get('name')), engine, baseUrl,
        apiUrl: String(data.get('apiUrl') ?? '').trim() || baseUrl, auth: String(data.get('auth')) as ProviderDefinition['auth'],
        safeRating: String(data.get('safeRating')) as 's' | 'g', mediaOrigins: String(data.get('mediaOrigins') ?? '').split(/[\s,]+/).filter(Boolean) });
      if (result.ok) { setProvider(result.value.id); setEditing(null); }
      return result;
    }, 'Booru connection saved. Select it in Discover; credentials can be added below.');
  }

  return <dialog ref={ref} className="settings-dialog" aria-labelledby="settings-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="details-content"><header><div><p className="eyebrow">YOUR WORKSPACE</p><h2 id="settings-title">Settings</h2></div><button className="close-button" onClick={onClose} aria-label="Close settings">×</button></header>
      {!settings && !error && <p role="status">Loading settings…</p>}
      {settings && <>
        <section aria-labelledby="browsing-settings"><h3 id="browsing-settings">Browsing & display</h3><div className="settings-form">
          <label htmlFor="browsing-mode">Load results</label><select id="browsing-mode" value={preferences.browsing} disabled={busy || preferencesBusy} onChange={(event) => void onPreferences({ ...preferences, browsing: event.target.value as Preferences['browsing'] })}><option value="pages">Numbered pages</option><option value="infinite">Infinite scrolling</option></select>
          <label htmlFor="grid-mode">Image grid</label><select id="grid-mode" value={preferences.gridMode} disabled={busy || preferencesBusy} onChange={(event) => void onPreferences({ ...preferences, gridMode: event.target.value as Preferences['gridMode'] })}><option value="natural">Original proportions · flowing grid</option><option value="crop">Cropped images · aligned grid</option></select>
          <p className="settings-help">Applies to Discover, Gallery and Collections.</p>
        </div></section>
        <section aria-labelledby="archive-settings"><h3 id="archive-settings">{isAndroid ? 'Private archive' : 'Archive folder'}</h3><p className="settings-help">{isAndroid ? 'Testing preview 0.1.0-preview.2. Export before uninstalling or changing APK signing identity: uninstalling removes the private archive. Downloads stop when the app leaves the foreground.' : 'Keep this entire folder together when moving or backing up your library.'}</p>
          <p className="folder-path">{settings.library.root ?? 'No archive folder selected.'}</p>
          {capabilities.chooseLibrary && <button disabled={busy || downloading} onClick={() => void run(() => window.foliuna.chooseLibrary(), 'Archive selection checked. The current folder is shown above.')}>Choose archive folder</button>}
          {capabilities.exportLibrary && <button disabled={busy || downloading} onClick={() => void run(async () => { const result = await window.foliuna.exportLibrary(); if (result.ok && result.value.cancelled) return { ok: false, error: { code: 'CANCELLED', message: 'Export cancelled. Your archive is unchanged.' } }; return result; }, 'Export complete in a new Foliuna folder. Copy the complete folder to Windows, choose it as the archive, then Import sidecars.')}>Export library…</button>}
          {settings.library.issue && <p className="error-message">{settings.library.issue}</p>}
        </section>
        <section aria-labelledby="booru-settings"><h3 id="booru-settings">Booru connections</h3>
          <div className="settings-form"><label htmlFor="connection-provider">Connection</label><select id="connection-provider" value={provider} disabled={busy} onChange={(event) => setProvider(event.target.value)}>{sources.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></div>
          <p className="settings-help">{source.name} · {source.engine} · API: {source.apiUrl}<br />{source.auth === 'query' ? 'Uses a numeric user ID and API key in HTTPS API requests, as required by this site.' : source.auth === 'basic' ? 'Uses your site username and API key in the HTTPS authorization header.' : 'Anonymous API reads; account credentials are not supported for this connection.'}</p>
          {provider.startsWith('custom-') && <div className="settings-buttons"><button disabled={busy || downloading} onClick={() => { setEditing(source); setEngine(source.engine as 'danbooru' | 'gelbooru'); }}>Edit connection</button><button disabled={busy || downloading} onClick={() => void run(async () => { const response = await window.foliuna.removeProvider(provider); if (response.ok) setProvider('e621'); return response; }, 'Connection and its saved credentials removed. Archived files and source history remain available in Gallery.')}>Remove connection</button></div>}
          <details open={editing ? true : undefined}><summary>Add or update a custom booru</summary>
            <form key={editing?.id ?? 'new'} onSubmit={saveCustom} className="settings-form">
              <label htmlFor="booru-name">Booru name</label><input id="booru-name" name="name" maxLength={80} required defaultValue={editing?.name} disabled={busy || downloading} />
              <label htmlFor="booru-engine">API engine</label><select id="booru-engine" value={engine} onChange={(event) => setEngine(event.target.value as typeof engine)} disabled={busy || downloading}><option value="danbooru">Danbooru JSON</option><option value="gelbooru">Gelbooru DAPI JSON</option></select>
              <label htmlFor="booru-url">Site URL</label><input id="booru-url" name="baseUrl" type="url" required placeholder="https://your-booru.org/" defaultValue={editing?.baseUrl} disabled={busy || downloading} />
              <label htmlFor="booru-api">API base URL (optional)</label><input id="booru-api" name="apiUrl" type="url" placeholder="Same as site URL; do not include posts.json or index.php" defaultValue={editing?.apiUrl} disabled={busy || downloading} />
              <label htmlFor="booru-auth">API authentication</label><select key={`${engine}-auth`} id="booru-auth" name="auth" defaultValue={editing?.auth ?? (engine === 'danbooru' ? 'basic' : 'query')} disabled={busy || downloading}><option value="none">Anonymous</option><option value="basic">Username + API key (Basic)</option><option value="query">Numeric user ID + API key (query)</option></select>
              <label htmlFor="booru-safe">Site’s safe rating</label><select key={`${engine}-safe`} id="booru-safe" name="safeRating" defaultValue={editing?.safeRating ?? (engine === 'danbooru' ? 'g' : 's')} disabled={busy || downloading}><option value="g">General · rating:g (modern Danbooru/Gelbooru)</option><option value="s">Safe · rating:s (older APIs)</option></select>
              <label htmlFor="booru-media">Additional media hosts (optional)</label><textarea id="booru-media" name="mediaOrigins" rows={3} placeholder="https://cdn.your-booru.org" defaultValue={editing?.mediaOrigins.join('\n')} disabled={busy || downloading} />
              <p className="settings-help">Use a compatible public HTTPS site. API paths are added automatically. Add only media hosts you trust, separated by commas or new lines. Keys go only to the exact API base configured here; media requests receive no credentials. Changing either URL creates a separate connection. XML-only APIs and sites requiring browser challenges are unsupported.</p>
              <button className="primary-button" disabled={busy || downloading}>Save booru connection</button>{editing && <button type="button" disabled={busy} onClick={() => setEditing(null)}>Cancel editing</button>}
            </form>
          </details>
        </section>
        <section aria-labelledby="account-settings"><h3 id="account-settings">{source.name} credentials</h3><p className="settings-help">Generate a key in this site’s account/API settings. {source.auth === 'query' ? 'Enter the numeric user ID supplied with your API key.' : 'Enter your site username and API key.'} Never enter an account password. Rule34.xxx requires its own key; credentials are separate for every connection.</p>
          <form onSubmit={save} className="settings-form">
            <p className="credential-state">{account?.locked ? 'Saved entry cannot be unlocked. Replace or remove it.' : account?.saved ? `Encrypted entry saved for ${account.username}.` : 'No credentials saved for this provider.'}</p>
            <label htmlFor="credential-username">{source.auth === 'query' ? 'Numeric user ID' : 'Site username'}</label><input id="credential-username" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={100} autoComplete="off" disabled={busy || source.auth === 'none'} required />
            <label htmlFor="credential-key">API key</label><input id="credential-key" ref={password} type="password" maxLength={256} autoComplete="new-password" spellCheck={false} disabled={busy || !settings.encryptionAvailable || source.auth === 'none'} required placeholder={account?.saved ? 'Enter a new key to replace the saved entry' : 'Paste your provider API key'} />
            <div className="settings-buttons"><button type="submit" className="primary-button" disabled={busy || !settings.encryptionAvailable || source.auth === 'none'}>{busy ? 'Working…' : 'Save credentials'}</button><button type="button" disabled={busy || account?.locked || (provider === 'e621' && !account?.saved)} onClick={() => void run(() => window.foliuna.testConnection(provider), 'The provider returned a valid JSON response for this connection.')}>Test connection</button><button type="button" disabled={busy || !account?.saved} onClick={() => void run(() => window.foliuna.removeCredentials(provider), 'Saved credentials removed from Foliuna. Revoke the key on the site if needed.')}>Remove credentials</button></div>
          </form>
          <p className="settings-help">{isAndroid ? 'Encrypted with Android Keystore. Keys stay out of exports and are decrypted only for requests to their configured API.' : 'Saved with Windows account encryption. Keys stay out of archives. Foliuna decrypts them for API requests; other software running as your Windows user could also access them.'}</p>
          {!settings.encryptionAvailable && <p className="error-message">Secure {isAndroid ? 'Android' : 'Windows'} encryption is unavailable. Foliuna will not save credentials in plaintext.</p>}
        </section>
      </>}
      {message && <p role="status" className="success-message">{message}</p>}{error && <p role="alert" className="error-message">{error}</p>}
    </div>
  </dialog>;
}
