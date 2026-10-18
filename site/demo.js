const species = ['fox', 'wolf', 'deer', 'deer', 'fox', 'wolf'];
const posts = species.map((animal, index) => ({ id: 1001 + index, animal, title: ['Woodland wanderer', 'Among the pines', 'A quieter clearing'][index % 3], tags: [animal, 'forest', 'illustration', 'foliuna_demo'] }));
const grid = document.querySelector('#demo-grid');
const query = document.querySelector('#demo-tags');
const details = document.querySelector('#demo-details');
let opener;
function render() {
  const terms = query.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const result = posts.filter((post) => terms.every((term) => term.startsWith('-') ? !post.tags.includes(term.slice(1)) : post.tags.some((tag) => tag.includes(term))));
  grid.replaceChildren(...result.map((post) => {
    const button = document.createElement('button'); button.className = 'demo-card'; button.setAttribute('aria-label', 'View demo post ' + post.id);
    const image = document.createElement('img'); image.src = './assets/' + post.animal + '.svg'; image.alt = 'Fictional ' + post.animal + ' illustration'; image.loading = 'lazy';
    const title = document.createElement('strong'); title.textContent = post.title + ' · #' + post.id;
    const tags = document.createElement('small'); tags.textContent = post.tags.slice(0, 3).join(' · ');
    button.append(image, title, tags); button.addEventListener('click', () => openPost(post, button)); return button;
  }));
  document.querySelector('#demo-status').textContent = result.length + ' fictional posts · local artwork';
  document.querySelector('#demo-empty').hidden = result.length !== 0;
}
function openPost(post, button) {
  opener = button;
  document.querySelector('#demo-post-title').textContent = post.title;
  const image = document.querySelector('#demo-image'); image.src = './assets/' + post.animal + '.svg'; image.alt = 'Fictional ' + post.animal + ' illustration';
  document.querySelector('#demo-description').textContent = 'A local Foliuna illustration. In the app, this space shows post information, source history and categorized tags.';
  document.querySelector('#demo-post-tags').replaceChildren(...post.tags.map((tag) => {
    const tagButton = document.createElement('button'); tagButton.textContent = tag;
    tagButton.addEventListener('click', () => { query.value = tag; details.close(); render(); query.focus(); }); return tagButton;
  }));
  details.showModal();
}
document.querySelector('#demo-search').addEventListener('submit', (event) => { event.preventDefault(); render(); });
document.querySelector('#demo-layout').addEventListener('click', (event) => {
  const cropped = grid.classList.toggle('crop'); grid.classList.toggle('natural', !cropped);
  event.currentTarget.textContent = cropped ? 'Original proportions' : 'Crop grid'; event.currentTarget.setAttribute('aria-pressed', String(cropped));
});
document.querySelector('.dialog-close').addEventListener('click', () => details.close());
details.addEventListener('close', () => { if (opener?.isConnected) opener.focus(); });
details.addEventListener('click', (event) => { if (event.target === details && event.clientX < details.getBoundingClientRect().left) details.close(); });
render();
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
