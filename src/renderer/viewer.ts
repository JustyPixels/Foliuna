import './viewer.css';

const error = document.getElementById('error')!;
try {
  const data = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  if (!Number.isSafeInteger(data.id) || data.id < 1 || typeof data.asset !== 'string' ||
    !/^\/(?:media\/[a-z][a-z0-9-]{0,63}\/[1-9]\d*\/(?:sample|original)|gallery\/[0-9a-f]{64}\/original|demo\/(?:fox|wolf|deer)\.svg)$/.test(data.asset)) throw new Error();
  document.getElementById('title')!.textContent = `Post #${data.id} · Resize this window to fit · Escape exits fullscreen`;
  let element: HTMLImageElement | HTMLVideoElement | HTMLIFrameElement;
  if (data.extension === 'swf') {
    element = document.createElement('iframe'); element.title = 'Isolated Flash player';
    element.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    element.src = data.archiveSha && /^[0-9a-f]{64}$/.test(data.archiveSha) ? `foliuna://player/swf.html#gallery/${data.archiveSha}` : `foliuna://player/swf.html#${data.asset.split('/')[2]}/${data.id}`;
  } else if (['webm', 'mp4'].includes(data.extension)) {
    element = document.createElement('video'); element.controls = true; element.preload = 'none'; element.src = data.asset;
  } else { element = document.createElement('img'); element.alt = `Post ${data.id}`; element.src = data.asset; }
  element.addEventListener('error', () => { error.textContent = 'Media could not load. Close this window and retry from post details.'; });
  document.getElementById('media')!.append(element);
} catch { error.textContent = 'This media window is invalid.'; }
document.getElementById('close')!.onclick = () => window.close();
document.getElementById('fullscreen')!.onclick = () => {
  const task = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  void task.catch(() => { error.textContent = 'Use F11 to enter or leave fullscreen.'; });
};
