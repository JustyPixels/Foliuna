const paths = {
  discover: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  gallery: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  collections: 'M4 5h16v16H4zM8 2h12M8 10h8M8 15h8',
  minimize: 'M5 12h14', maximize: 'M5 5h14v14H5z', close: 'M6 6l12 12M18 6 6 18',
  fullscreen: 'M9 3H3v6M15 3h6v6M3 15v6h6M21 15v6h-6',
  previous: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7',
  play: 'M7 4l14 8-14 8z', pause: 'M8 4v16M16 4v16',
  volume: 'M3 9h4l5-5v16l-5-5H3zM16 8q6 4 0 8', muted: 'M3 9h4l5-5v16l-5-5H3zM17 9l5 6M22 9l-5 6',
} as const;
export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
