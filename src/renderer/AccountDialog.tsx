import { useEffect, useState } from 'react';
import type { Account, Preferences } from '../shared/contracts';
import { useDialog } from './useDialog';

export function AccountDialog({ preferences, onClose, onSearch, onRemove }: { preferences: Preferences; onClose(): void; onSearch(tags: string, provider?: string): void; onRemove(tag: string): void }) {
  const ref = useDialog();
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    window.foliuna.getAccount().then((response) => { if (active) { if (response.ok) setAccount(response.value); else setError(response.error.message); } })
      .catch(() => { if (active) setError('Account details could not load.'); });
    return () => { active = false; };
  }, []);
  return <dialog ref={ref} className="settings-dialog" aria-labelledby="account-title" onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="details-content">
    <header><h2 id="account-title">Account & favorites</h2><button className="close-button" aria-label="Close account" onClick={onClose}>×</button></header>
    <p className="settings-help">Site account details currently use e621. Other boorus support search and downloads; Foliuna favorite tags below work with your selected source.</p>
    {!account && !error && <p role="status">Loading e621 account…</p>}{error && <p role="alert" className="error-message">{error}</p>}
    {account && <section><h3>{account.name}</h3><p>{account.level} · #{account.id} · Joined {account.joined ? new Date(account.joined).toLocaleDateString() : 'unknown'}</p>
      <p>{account.favorites.toLocaleString()} favorites · {account.uploads.toLocaleString()} uploads</p>
      <button onClick={() => onSearch(`fav:!${account.id}`, 'e621')}>View my e621 favorite posts</button>
      <h3>e621 favorite tags & artists</h3><p className="settings-help">Read from your site account. Select a tag to browse its posts. This view does not change your e621 account.</p>
      <div className="favorite-tags">{account.favoriteTags.map((tag) => <button key={tag} onClick={() => onSearch(tag, 'e621')}>{tag}</button>)}</div>
      {!account.favoriteTags.length && <p>No site favorite tags returned.</p>}</section>}
    <section><h3>Foliuna favorite tags & artists</h3><p className="settings-help">Saved on this computer from post details. Artist tags work here too.</p>
      <div className="favorite-tags">{preferences.favoriteTags.map((tag) => <span key={tag}><button onClick={() => onSearch(tag)}>{tag}</button><button aria-label={`Unfavorite ${tag}`} onClick={() => onRemove(tag)}>×</button></span>)}</div>
      {!preferences.favoriteTags.length && <p>Click a tag in post details to favorite it.</p>}</section>
  </div></dialog>;
}
