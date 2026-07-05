import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

export const newId = (): string => randomUUID();

export const hashPassword = (plain: string, rounds: number): Promise<string> =>
  bcrypt.hash(plain, rounds);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);

/** Opaque refresh token: 256 bits of entropy; only its SHA-256 is stored. */
export const newRefreshToken = (): string => randomBytes(32).toString('base64url');

export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
