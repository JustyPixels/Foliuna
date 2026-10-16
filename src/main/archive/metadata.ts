import { basename } from 'node:path';
import type { CategorizedTags, Provider } from '../../shared/contracts';
import { record } from '../../shared/validation';
import type { DatabaseSync } from 'node:sqlite';

const sensitive = /^(?:api_?key|authorization|password|access_?token|token|secret|login)$/i;

export function portableMetadata(value: Record<string, unknown>): Record<string, unknown> {
  // Provider metadata is retained except credentials and transient CDN URL parameters.
  return JSON.parse(JSON.stringify(value, (key, item: unknown) => {
    if (sensitive.test(key)) return undefined;
    if (typeof item === 'string' && /^https?:\/\//i.test(item)) {
      try {
        const url = new URL(item);
        url.username = ''; url.password = '';
        if (['static1.e621.net', 'static2.e621.net'].includes(url.hostname)) { url.search = ''; url.hash = ''; }
        else for (const name of [...url.searchParams.keys()]) if (sensitive.test(name)) url.searchParams.delete(name);
        return url.href;
      } catch { return item; }
    }
    return item;
  })) as Record<string, unknown>;
}

export interface SidecarSource {
  provider: Provider; postId: number; url: string;
  snapshots: { capturedAt: string; metadata: Record<string, unknown>; categorizedTags: CategorizedTags }[];
}
export function sidecar(sha256: string, bytes: number, path: string, sources: SidecarSource[]) {
  return { schemaVersion: 1, asset: { sha256, byteSize: bytes, mediaFile: basename(path) }, sources };
}

export function jsonRecord(value: unknown): Record<string, unknown> {
  return record(JSON.parse(String(value)));
}

export function assetSidecar(db: DatabaseSync, hash: string) {
  const asset = db.prepare('SELECT id,byte_size,relative_path FROM assets WHERE sha256=?').get(hash)!;
  const sources: SidecarSource[] = db.prepare('SELECT id,provider,post_id,source_url FROM source_posts WHERE asset_id=? ORDER BY provider,post_id').all(asset.id).map((source) => ({
    provider: source.provider as Provider, postId: Number(source.post_id), url: String(source.source_url),
    snapshots: db.prepare('SELECT metadata_json,tags_json,captured_at FROM source_snapshots WHERE source_post_id=? ORDER BY captured_at,id').all(source.id).map((snapshot) => ({
      capturedAt: String(snapshot.captured_at), metadata: jsonRecord(snapshot.metadata_json), categorizedTags: jsonRecord(snapshot.tags_json) as CategorizedTags,
    })),
  }));
  return sidecar(hash, Number(asset.byte_size), String(asset.relative_path), sources);
}
