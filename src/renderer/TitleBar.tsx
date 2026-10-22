import { useState } from 'react';
import { Icon } from './Icon';
export function TitleBar() {
  const [error, setError] = useState('');
  async function action(value: 'minimize' | 'maximize' | 'close') {
    try { const response = await window.foliuna.windowAction(value); if (!response.ok) setError(response.error.message); }
    catch { setError('Window controls are unavailable.'); }
  }
  return <header className="window-titlebar"><strong>Foliuna</strong><span>{error && <span role="alert">{error}</span>}</span><div>
    <button aria-label="Minimize window" onClick={() => void action('minimize')}><Icon name="minimize" /></button>
    <button aria-label="Maximize or restore window" onClick={() => void action('maximize')}><Icon name="maximize" /></button>
    <button aria-label="Close window" onClick={() => void action('close')}><Icon name="close" /></button>
  </div></header>;
}
