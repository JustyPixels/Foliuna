import { useEffect, useState, type FormEvent } from 'react';
import type { Collection, Result } from '../shared/contracts';

export function CollectionsPanel({ collections, selectedId, ready, disabled, onSelect, onResult, onBusy, onSetup }: {
  collections: Collection[]; selectedId: number | null; ready: boolean; disabled: boolean;
  onSelect(id: number | null): void; onResult(value: Collection[]): void; onBusy(value: boolean): void; onSetup(): void;
}) {
  const selected = collections.find((item) => item.id === selectedId);
  const [name, setName] = useState(''); const [rename, setRename] = useState(''); const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('');
  useEffect(() => { setRename(selected?.name ?? ''); setConfirmDelete(false); setError(''); }, [selected?.id, selected?.name]);
  async function run(action: () => Promise<Result<Collection[]>>, success: string, choose?: string) {
    setBusy(true); onBusy(true); setError(''); setMessage('');
    try {
      const response = await action();
      if (!response.ok) { setError(response.error.message); return; }
      onResult(response.value); setConfirmDelete(false); setMessage(success);
      onSelect(choose ? response.value.find((item) => item.name === choose)?.id ?? null : response.value.some((item) => item.id === selectedId) ? selectedId : response.value[0]?.id ?? null);
      if (choose) setName('');
    } catch { setError('Could not save collections. Your original files were preserved.'); }
    finally { setBusy(false); onBusy(false); }
  }
  function create(event: FormEvent) { event.preventDefault(); void run(() => window.foliuna.collectionCreate({ name }), 'Collection created.', name.trim().normalize('NFC')); }
  const blocked = disabled || busy || !ready;
  return <section className="collections-panel" aria-label="Collections management">

    {!ready && <button onClick={onSetup}>Choose archive folder in Settings</button>}
    <form className="collection-create" onSubmit={create}><label htmlFor="new-collection">New collection name</label><input id="new-collection" value={name} maxLength={100} disabled={blocked} onChange={(event) => setName(event.target.value)} placeholder="Landscapes, favorite artists…" /><button className="primary-button" disabled={blocked || !name.trim()}>Create collection</button></form>
    <label htmlFor="selected-collection">Collection</label><select id="selected-collection" value={selectedId ?? ''} disabled={blocked || !collections.length} onChange={(event) => { setMessage(''); onSelect(Number(event.target.value)); }}>
      {!collections.length && <option value="">No collections yet</option>}{collections.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.assets} items{item.pending ? ` · ${item.pending} awaiting import` : ''}</option>)}
    </select>
    {selected && <><p>{selected.assets} saved items{selected.pending ? ` · ${selected.pending} memberships awaiting matching sidecar imports` : ''}. Safe-only and tag filters can hide matching items.</p>
      <form className="collection-rename" onSubmit={(event) => { event.preventDefault(); void run(() => window.foliuna.collectionRename({ id: selected.id, name: rename }), 'Collection renamed.'); }}>
        <label htmlFor="rename-collection">Collection name</label><input id="rename-collection" value={rename} maxLength={100} disabled={blocked} onChange={(event) => setRename(event.target.value)} />
        <button disabled={blocked || !rename.trim() || rename === selected.name}>Rename collection</button><button type="button" disabled={blocked} onClick={() => setConfirmDelete(true)}>Delete collection</button>
      </form>
      {confirmDelete && <div className="collection-delete" role="group" aria-label="Confirm collection deletion"><p>Delete “{selected.name}” and its membership? All original files remain in Gallery.</p><button disabled={blocked} onClick={() => void run(() => window.foliuna.collectionDelete(selected.id), 'Collection removed. All media and source history remain in Gallery.')}>Confirm delete collection</button><button disabled={blocked} onClick={() => setConfirmDelete(false)}>Keep collection</button></div>}
    </>}
    {busy && <p role="status">Saving collections…</p>}{message && <p role="status" className="success-message">{message}</p>}{error && <p role="alert" className="error-message">{error}</p>}
  </section>;
}
