import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TagSuggestion } from '../shared/contracts';

export function TagSearch({ value, onChange, disabled, inputRef, gallery = false, provider = 'e621' }: { value: string; onChange(value: string): void; disabled: boolean; inputRef: RefObject<HTMLInputElement | null>; gallery?: boolean; provider?: string }) {
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const [caret, setCaret] = useState(value.length);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const before = value.slice(0, caret);
  const token = before.match(/\S+$/)?.[0] ?? '';
  const prefix = token.replace(/^[-~]/, '');
  useEffect(() => {
    setSuggestions([]); setActive(-1); setError('');
    if (!focused || disabled || prefix.length < 2 || prefix.length > 80 || /[\s*?%:]/.test(prefix)) return;
    let current = true;
    const timer = setTimeout(async () => {
      while (pending.current && current) await new Promise((resolve) => setTimeout(resolve, 150));
      if (!current) return;
      pending.current = true;
      try {
        const response = await (gallery ? window.foliuna.galleryTags(prefix) : window.foliuna.suggestTags(provider === 'e621' ? prefix : { provider, prefix }));
        if (current) { if (response.ok) setSuggestions(response.value); else setError(response.error.message); }
      } catch { if (current) setError('Suggestions unavailable. You can still search.'); }
      finally { pending.current = false; }
    }, 650);
    return () => { current = false; clearTimeout(timer); };
  }, [prefix, focused, disabled, gallery, provider]);

  function choose(name: string) {
    const start = caret - token.length;
    const rest = value.slice(caret).replace(/^\S*/, '');
    const replacement = `${token.startsWith('-') ? '-' : token.startsWith('~') ? '~' : ''}${name} `;
    onChange(`${value.slice(0, start)}${replacement}${rest.trimStart()}`);
    setCaret(start + replacement.length); setSuggestions([]); inputRef.current?.focus();
  }
  return <div className="query-field"><label htmlFor="tags">SEARCH TAGS</label><div><span aria-hidden="true">⌕</span>
    <input id="tags" ref={inputRef} value={value} maxLength={512} disabled={disabled} onChange={(event) => { onChange(event.target.value); setCaret(event.target.selectionStart ?? event.target.value.length); }}
      onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? value.length)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { setSuggestions([]); setFocused(false); return; }
        if (!suggestions.length) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => (index + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1) + suggestions.length) % suggestions.length); }
        if (event.key === 'Enter' && active >= 0) { event.preventDefault(); choose(suggestions[active].name); }
      }} role="combobox" aria-autocomplete="list" aria-expanded={suggestions.length > 0} aria-controls="tag-suggestions" aria-activedescendant={active >= 0 ? `suggestion-${active}` : undefined}
      placeholder="fox forest rating:s" aria-describedby="search-help" autoComplete="off" spellCheck={false} />
    </div>{suggestions.length > 0 && <ul className="tag-suggestions" id="tag-suggestions" role="listbox" aria-label="Tag suggestions">{suggestions.map((tag, index) =>
      <li key={tag.name} id={`suggestion-${index}`} role="option" aria-selected={active === index} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(tag.name)}><span>{tag.name}</span><small>{tag.recent ? 'Recent tag' : `${tag.count.toLocaleString()} posts`}</small></li>)}</ul>}
    {error && <small className="suggestion-error" role="status">{error}</small>}
  </div>;
}
