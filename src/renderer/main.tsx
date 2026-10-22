import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './viewing.css';
declare const __FOLIUNA_ANDROID__: boolean;

async function start() {
  if (__FOLIUNA_ANDROID__) await (await import('./android')).initializeAndroid();
  createRoot(document.getElementById('root')!).render(<App />);
}
void start();
