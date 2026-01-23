import { nanoid } from 'nanoid';

/**
 * nanoid works on Cloudflare Workers (uses Web Crypto).
 * We generate:
 * - codes: invite codes (group/swap)
 * - ids: queue item ids etc
 */

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0/I/1

function randomFromAlphabet(len: number, alphabet: string): string {
  // nanoid's customAlphabet exists, but keeping it dependency-light and explicit
  // while still using crypto.getRandomValues via nanoid for ids.
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const n = alphabet.length;

  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % n];
  return out;
}

export function inviteCode(length = 10): string {
  return randomFromAlphabet(length, INVITE_ALPHABET);
}

export function randomId(length = 16): string {
  // url-safe, good uniqueness
  // (length is characters)
  return nanoid(length);
}
