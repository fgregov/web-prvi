// Share-link tokens for the Follow-up Engine (ADR-0008). Web Crypto only, so
// the same code runs on the BETA server (Node) and in the in-browser demo.
//
//   token        32 random bytes, base64url (43 characters): the secret in /o/{token}
//   tokenHash    hex SHA-256 of the token: how a request finds its link
//   tokenSealed  AES-256-GCM(token) under a server key: lets "Kopiraj link" work
//                later without storing the token in readable form

import type { webcrypto } from 'node:crypto';

/** The AES-GCM key that seals tokens (a Web Crypto CryptoKey, in Node and in browsers). */
export type ShareKey = webcrypto.CryptoKey;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Exactly what newShareToken() produces; anything else is refused before any lookup. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** 256 bits from the platform's CSPRNG. */
export function newShareToken(): string {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data;
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const hashToken = (token: string) => sha256Hex(token);

/**
 * The AES-256-GCM key that seals tokens, derived (HKDF-SHA-256) from a server
 * secret. Same secret → same key, so sealed tokens survive a restart.
 */
export async function deriveShareKey(secret: string): Promise<ShareKey> {
  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('renvara-offer-share-links'),
      info: encoder.encode('v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealToken(key: ShareKey, token: string): Promise<string> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(token)),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return toBase64Url(out);
}

/** The token, or null when it was sealed under another key (secret rotated) or tampered with. */
export async function unsealToken(key: ShareKey, sealed: string): Promise<string | null> {
  try {
    const bytes = fromBase64Url(sealed);
    const plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12),
    );
    const token = decoder.decode(plain);
    return TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}
