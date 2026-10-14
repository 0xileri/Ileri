import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { randomToken } from '../lib/crypto';

/** Private file storage on local disk. Files are only served through signed URLs. */
export class LocalStorage {
  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  pathFor(key: string): string {
    return this.resolve(key);
  }

  private resolve(key: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('Invalid storage key');
    return path.join(this.root, key);
  }

  /** Streams to disk and enforces the size limit while writing. */
  async save(stream: Readable, maxBytes: number): Promise<{ key: string; size: number }> {
    const key = randomToken(24);
    const target = this.resolve(key);
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) stream.destroy(new Error('File too large'));
    });
    try {
      await pipeline(stream, fs.createWriteStream(target, { flags: 'wx' }));
    } catch (error) {
      fs.rmSync(target, { force: true });
      throw error;
    }
    return { key, size };
  }

  open(key: string): fs.ReadStream {
    return fs.createReadStream(this.resolve(key));
  }

  exists(key: string): boolean {
    return fs.existsSync(this.resolve(key));
  }
}
