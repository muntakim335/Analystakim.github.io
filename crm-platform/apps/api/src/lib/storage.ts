import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { newId } from './crypto.js';

/**
 * Pluggable blob storage. v1 ships local disk; an S3-compatible adapter
 * implements the same interface (see docs/02-architecture/system-architecture.md §6).
 */
export interface FileStorage {
  save(buffer: Buffer): Promise<string>;
  stream(key: string): Readable;
  remove(key: string): Promise<void>;
}

export function createLocalStorage(dir: string): FileStorage {
  const root = resolve(dir);
  const pathFor = (key: string) => {
    // keys are app-generated uuids; belt-and-braces against traversal anyway
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('invalid storage key');
    return join(root, key);
  };
  return {
    async save(buffer) {
      await mkdir(root, { recursive: true });
      const key = newId();
      await writeFile(pathFor(key), buffer);
      return key;
    },
    stream(key) {
      return createReadStream(pathFor(key));
    },
    async remove(key) {
      await unlink(pathFor(key)).catch(() => {});
    },
  };
}
