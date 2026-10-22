import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { VideoPlayer } from './VideoPlayer';
import { Icon } from './Icon';
import './viewing.css';
import './viewer.css';
function Viewer() {
  const [error, setError] = useState('');
  let data: { id: number; asset: string; extension: string; archiveSha?: string };
  try {
    data = JSON.parse(decodeURIComponent(location.hash.slice(1)));
    if (!Number.isSafeInteger(data.id) || data.id < 1 || typeof data.asset !== 'string' || !/^\/(?:media\/[a-z][a-z0-9-]{0,63}\/[1-9]\d*\/(?:sample|original)|gallery\/[0-9a-f]{64}\/original)$/.test(data.asset)) throw Error();
  } catch { return <p role="alert">This media window is invalid.</p>; }
  function fullscreen() { void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => setError('Fullscreen could not start.')); }
  return <><header className="floating-header"><span>Foliuna · Post #{data.id}</span><button onClick={fullscreen} aria-label="Fullscreen · F11"><Icon name="fullscreen" /></button><button onClick={() => window.close()} aria-label="Close window"><Icon name="close" /></button></header>
    <main className="floating-media">{data.extension === 'swf' ? <iframe title="Isolated Flash player" sandbox="allow-scripts allow-same-origin" src={data.archiveSha && /^[0-9a-f]{64}$/.test(data.archiveSha) ? `foliuna://player/swf.html#gallery/${data.archiveSha}` : `foliuna://player/swf.html#${data.asset.split('/')[2]}/${data.id}`} /> : ['webm', 'mp4'].includes(data.extension) ? <VideoPlayer src={data.asset} label={`Video of post ${data.id}`} onFullscreen={fullscreen} /> : <img src={data.asset} alt={`Post ${data.id}`} onError={() => setError('Media could not load. Reopen this post to retry.')} />}</main>{error && <p role="alert">{error}</p>}</>;
}
createRoot(document.getElementById('root')!).render(<Viewer />);
