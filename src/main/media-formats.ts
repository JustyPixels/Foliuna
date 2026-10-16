export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
export const MEDIA_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', webm: 'video/webm', mp4: 'video/mp4',
  swf: 'application/x-shockwave-flash',
};

export function mediaSignature(bytes: Buffer, extension: string): boolean {
  switch (extension) {
    case 'jpg': case 'jpeg': return bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
    case 'png': return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case 'gif': return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
    case 'webp': return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    case 'webm': return bytes.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
    case 'mp4': return bytes.subarray(4, 8).toString() === 'ftyp';
    case 'swf': return bytes.length >= 8 && ['FWS', 'CWS', 'ZWS'].includes(bytes.subarray(0, 3).toString()) && bytes[3] >= 1 && bytes[3] <= 50 && bytes.readUInt32LE(4) >= 8 && bytes.readUInt32LE(4) <= MAX_MEDIA_BYTES;
    default: return false;
  }
}
