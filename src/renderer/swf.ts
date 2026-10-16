import './viewer.css';

const error = document.getElementById('error')!;
const match = /^#([a-z][a-z0-9-]{0,63}\/[1-9]\d*|gallery\/[0-9a-f]{64})$/.exec(location.hash);
if (!match) error.textContent = 'Invalid Flash post.';
else {
  const script = document.createElement('script'); script.src = '/ruffle/ruffle.js';
  script.onerror = () => { error.textContent = 'The bundled Flash player could not load.'; };
  script.onload = async () => {
    try {
      const ruffle = (window as unknown as { RufflePlayer: { newest(): { createPlayer(): HTMLElement & { ruffle(): { load(config: unknown): Promise<void> } } } } }).RufflePlayer.newest();
      const player = ruffle.createPlayer(); document.getElementById('media')!.append(player);
      await player.ruffle().load({ url: match[1].startsWith('gallery/') ? `/${match[1]}/original` : `/media/${match[1]}/original`, publicPath: '/ruffle/', autoplay: 'off',
        allowScriptAccess: false, allowNetworking: 'none', openUrlMode: 'deny', showSwfDownload: false, contextMenu: 'off',
        letterbox: 'on', scale: 'showAll', maxExecutionDuration: 5, backgroundExecutionMode: 'none' });
      error.textContent = '';
    } catch { error.textContent = 'This SWF could not play. Ruffle does not support every Flash file; external resources are blocked.'; }
  };
  document.head.append(script);
}
