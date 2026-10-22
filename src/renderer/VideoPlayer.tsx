import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Icon } from './Icon';
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export type Playback = { src: string; time: number; playing: boolean; muted: boolean; volume: number; speed: number };
export function VideoPlayer({ src, poster, label, onFullscreen, playback }: { src: string; poster?: string; label: string; onFullscreen?(): void; playback?: RefObject<Playback | null> }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false), [time, setTime] = useState(0), [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false), [volume, setVolume] = useState(1), [error, setError] = useState('');
  const [speed, setSpeed] = useState(1);
  useLayoutEffect(() => {
    const video = ref.current!, saved = playback?.current;
    const restore = () => { if (saved?.src === src) { video.currentTime = saved.time; if (saved.playing) void video.play().catch(() => setError('Press Play to resume.')); } };
    if (saved?.src === src) {
      video.muted = saved.muted; video.volume = saved.volume; video.defaultPlaybackRate = saved.speed; video.playbackRate = saved.speed; setSpeed(saved.speed);
      video.addEventListener('loadedmetadata', restore, { once: true }); video.load();
    }
    return () => {
      if (playback) playback.current = { src, time: video.currentTime, playing: !video.paused && !video.ended, muted: video.muted, volume: video.volume, speed: video.playbackRate };
      video.removeEventListener('loadedmetadata', restore); video.pause();
    };
  }, [src, playback]);
  async function toggle() {
    const video = ref.current!;
    if (!video.paused) video.pause();
    else try { await video.play(); setError(''); } catch { setError('Playback could not start. Retry or choose another supported format.'); }
  }
  function seek(value: number) { const video = ref.current!; if (Number.isFinite(video.duration)) video.currentTime = Math.min(video.duration, Math.max(0, value)); }
  return <div className="video-player" data-media-controls onKeyDown={(event) => {
    if ((event.target as HTMLElement).matches('input,button')) return;
    if (event.key === ' ' || event.key.toLowerCase() === 'k') { event.preventDefault(); void toggle(); }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); seek(ref.current!.currentTime + (event.key === 'ArrowRight' ? 5 : -5)); }
  }}>
    <video ref={ref} key={src} src={src} poster={poster} preload="none" playsInline tabIndex={0} aria-label={label}
      onClick={() => void toggle()} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)} onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onVolumeChange={(event) => { setMuted(event.currentTarget.muted); setVolume(event.currentTarget.volume); }} onError={() => setError('Video could not play. This codec may not be supported on this device.')} />
    <div className="player-controls">
      <button aria-label={playing ? 'Pause video' : 'Play video'} onClick={() => void toggle()}><Icon name={playing ? 'pause' : 'play'} /></button>
      <span className="playback-time">{clock(time)} / {clock(duration)}</span>
      <input aria-label="Video position" type="range" min="0" max={duration || 1} step="0.1" value={Math.min(time, duration || 1)} disabled={!duration} onChange={(event) => seek(Number(event.target.value))} />
      <button aria-label={muted ? 'Unmute video' : 'Mute video'} onClick={() => { ref.current!.muted = !muted; }}><Icon name={muted || volume === 0 ? 'muted' : 'volume'} /></button>
      <input className="player-volume" aria-label="Video volume" type="range" min="0" max="1" step="0.05" value={muted ? 0 : volume} onChange={(event) => { ref.current!.volume = Number(event.target.value); ref.current!.muted = false; }} />
      <select aria-label="Playback speed" value={speed} onChange={(event) => { const value = Number(event.target.value); ref.current!.playbackRate = value; setSpeed(value); }}><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
      {onFullscreen && <button aria-label="Fullscreen video" onClick={onFullscreen}><Icon name="fullscreen" /></button>}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
