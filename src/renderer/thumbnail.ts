export async function cacheThumbnail(hash: string, media: HTMLImageElement | HTMLVideoElement): Promise<boolean> {
  const width = media instanceof HTMLVideoElement ? media.videoWidth : media.naturalWidth;
  const height = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  if (!width || !height || width * height > 100000000) return false;
  try {
    const canvas = document.createElement('canvas'); const scale = Math.min(1, 512 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d'); if (!context) return false;
    context.drawImage(media, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png || png.size > 2 * 1024 * 1024) return false;
    return (await window.foliuna.cacheThumbnail({ sha256: hash, png: new Uint8Array(await png.arrayBuffer()) })).ok;
  } catch { return false; }
}
