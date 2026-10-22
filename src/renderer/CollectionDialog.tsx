import { useEffect, useState } from 'react';
import type { Collection, Post } from '../shared/contracts';
import { useDialog } from './useDialog';

export function CollectionDialog({ post, onClose, onChanged }: { post: Post; onClose(): void; onChanged(): void }) {
  const ref = useDialog(); const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  const hash = post.archive!.sha256;
  useEffect(() => {
    let active = true;
    window.foliuna.collectionList({ sha256: hash }).then((response) => {
      if (!active) return;
      if (response.ok) setCollections(response.value); else setError(response.error.message);
    }).catch(() => { if (active) setError('Could not load collections.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [hash]);
  async function toggle(item: Collection) {
    setBusy(true); setError(''); setMessage('');
    try {
      const response = await window.foliuna.collectionMembership({ id: item.id, sha256: hash, present: !item.contains });
      if (!response.ok) { setError(response.error.message); return; }
      setCollections((previous) => response.value.map((value) => ({ ...value, contains: value.id === item.id ? !item.contains : previous.find((old) => old.id === value.id)?.contains })));
      setMessage(item.contains ? `Removed from ${item.name}. Original media stays in Gallery.` : `Added to ${item.name}.`); onChanged();
    } catch { setError('Could not update membership. Your original files were preserved.'); }
    finally { setBusy(false); }
  }
  return <dialog ref={ref} className="settings-dialog" aria-labelledby="collect-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}><div className="details-content">
    <header><div><p className="eyebrow">SAVED MEDIA</p><h2 id="collect-title">Collections for post #{post.id}</h2></div><button className="close-button" aria-label="Close collections" disabled={busy} onClick={onClose}>×</button></header>
    <p>Choose where to keep this saved item.</p>
    {loading && <p role="status">Loading collections…</p>}
    {!loading && !collections.length && !error && <p>Create a collection from Collections in the sidebar, then add this saved item here.</p>}
    <div className="collection-membership">{collections.map((item) => <label key={item.id}><input type="checkbox" checked={!!item.contains} disabled={busy} onChange={() => void toggle(item)} /><span>{item.name}<small>{item.assets} saved items</small></span></label>)}</div>
    {busy && <p role="status">Saving membership…</p>}{message && <p role="status" className="success-message">{message}</p>}{error && <p role="alert" className="error-message">{error}</p>}
    <button disabled={busy} onClick={onClose}>Done</button>
  </div></dialog>;
}
