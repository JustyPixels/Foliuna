const motion = matchMedia('(prefers-reduced-motion: reduce)');
const reveals = [...document.querySelectorAll('.reveal')];
const hero = document.querySelector('.hero-art');
let queued = false;
const observer = new IntersectionObserver(entries => entries.forEach(entry => { if(entry.isIntersecting) entry.target.classList.add('is-visible'); }), {threshold:0.12});
reveals.forEach(element => observer.observe(element));
function renderScroll() {
  queued = false;
  if(motion.matches) return;
  const maximum = document.documentElement.scrollHeight - innerHeight;
  document.documentElement.style.setProperty('--progress', String(maximum > 0 ? scrollY / maximum : 0));
  hero.style.setProperty('--drift', Math.min(100, scrollY * 0.13) + 'px');
  hero.style.setProperty('--turn', Math.min(3, scrollY * 0.004) + 'deg');
}
function preference() {
  document.documentElement.classList.toggle('motion-ready', !motion.matches);
  if(motion.matches) { hero.style.removeProperty('--drift'); hero.style.removeProperty('--turn'); } else renderScroll();
}
addEventListener('scroll', () => { if(!queued && !motion.matches) { queued=true; requestAnimationFrame(renderScroll); } }, {passive:true});
if(motion.addEventListener) motion.addEventListener('change', preference); else motion.addListener(preference);
preference();
const rotationButton = document.querySelector('#artwork-rotation');
let rotating = !motion.matches;
function rotationLabel() { rotationButton.textContent = rotating ? 'Pause images' : 'Play images'; rotationButton.setAttribute('aria-pressed', String(rotating)); }
rotationLabel();
rotationButton.addEventListener('click', () => { rotating = !rotating; rotationLabel(); });
const changedMotion = () => { if(motion.matches) { rotating = false; rotationLabel(); } };
if(motion.addEventListener) motion.addEventListener('change', changedMotion); else motion.addListener(changedMotion);
fetch('./artwork/credits.json').then(response => { if(!response.ok) throw Error(); return response.json(); }).then(artwork => {
  const image = hero.querySelector('img'), caption = hero.querySelector('figcaption');
  setInterval(async () => {
    if(!rotating || document.hidden || hero.matches(':hover') || hero.contains(document.activeElement)) return;
    const choices = artwork.filter(art => art.file !== hero.dataset.artwork);
    const art = choices[Math.floor(Math.random() * choices.length)];
    if(!art) return;
    const next = new Image(); next.src = './artwork/' + art.file;
    try { await next.decode(); } catch { return; }
    image.src = next.src; image.alt = art.title + ' by ' + art.artist; hero.dataset.artwork = art.file;
    const title = document.createElement('strong'); title.textContent = art.title;
    caption.replaceChildren(title, ' by ');
    for(const [label, href] of [[art.artist, art.artistUrl], ['e621 #' + art.id, art.post], ['Source', art.source]]) {
      const url = new URL(href); if(url.protocol !== 'https:') continue;
      const link = document.createElement('a'); link.textContent = label; link.href = url.href; caption.append(link, ' · ');
    }
    const note = document.createElement('small'); note.textContent = 'Artwork © its artist. ' + art.changes; caption.append(note);
  }, 5000);
}).catch(() => { rotationButton.hidden = true; });
fetch('./releases.json').then((response) => { if (!response.ok) throw Error(); return response.json(); }).then((releases) => {
  for (const platform of ['windows', 'android']) {
    const release = releases[platform]; if (!release) continue;
    const url = new URL(release.download);
    if (url.origin !== 'https://github.com' || !url.pathname.toLowerCase().startsWith('/justypixels/foliuna/releases/download/')) continue;
    const button = document.querySelector('#' + platform + '-download');
    button.href = url.href; button.textContent = platform === 'android' ? 'Download testing APK ↓' : 'Download Windows installer ↓';
    document.querySelector('#' + platform + '-version').textContent = release.version + (platform === 'android' ? ' · debug-signed preview' : ' · unsigned candidate');
  }
}).catch(() => { document.querySelector('#windows-version').textContent = 'View GitHub Releases for available builds.'; });
