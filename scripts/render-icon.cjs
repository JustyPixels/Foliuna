const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, webPreferences: { offscreen: true, sandbox: true, nodeIntegration: false, contextIsolation: true } });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#183b2c"/><path d="M25 6C12 3 5 10 8 20c10 4 19-2 17-14Z" fill="#b4d48b"/><path d="m7 26 13-14M13 20l-1-7m5 3 6 1" stroke="#183b2c" stroke-width="2" stroke-linecap="round"/></svg>';
  await window.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0">${svg}</body>`)}`);
  await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const image = await window.webContents.capturePage();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((width) => image.resize({ width, height: width, quality: 'best' }).toPNG());
  const header = Buffer.alloc(6 + sizes.length * 16); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => { const at = 6 + index * 16; header[at] = header[at + 1] = size === 256 ? 0 : size; header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6); header.writeUInt32LE(pngs[index].length, at + 8); header.writeUInt32LE(offset, at + 12); offset += pngs[index].length; });
  mkdirSync('build', { recursive: true }); writeFileSync('build/icon.png', image.resize({ width: 256, height: 256 }).toPNG());
  writeFileSync('build/icon.ico', Buffer.concat([header, ...pngs]));
  window.destroy(); app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
