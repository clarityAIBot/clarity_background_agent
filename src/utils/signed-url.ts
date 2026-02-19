/**
 * Signed URL utilities for time-limited, unauthenticated access.
 * Uses HMAC-SHA256 with the JWT_SECRET to sign request IDs + expiry.
 */

const DEFAULT_TTL_SECONDS = 3600; // 1 hour

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function toBase64Url(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return new Uint8Array(atob(padded).split('').map(c => c.charCodeAt(0)));
}

/**
 * Generate a signed token for a resource.
 * Token format: base64url(expires:requestId).base64url(hmac-signature)
 */
export async function generateSignedToken(
  requestId: string,
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<{ token: string; expires: number }> {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${expires}:${requestId}`;

  const key = await getHmacKey(secret);
  const payloadBytes = new TextEncoder().encode(payload);
  const signature = await crypto.subtle.sign('HMAC', key, payloadBytes);

  const token = `${toBase64Url(payloadBytes.buffer as ArrayBuffer)}.${toBase64Url(signature)}`;
  return { token, expires };
}

/**
 * Verify a signed token and return the request ID if valid.
 * Returns null if expired or signature invalid.
 */
export async function verifySignedToken(
  token: string,
  secret: string
): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signatureB64] = parts;

  try {
    const payloadBytes = fromBase64Url(payloadB64);
    const signatureBytes = fromBase64Url(signatureB64);
    const payload = new TextDecoder().decode(payloadBytes);

    // Verify signature
    const key = await getHmacKey(secret);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      payloadBytes
    );

    if (!valid) return null;

    // Check expiry
    const colonIndex = payload.indexOf(':');
    if (colonIndex === -1) return null;

    const expires = parseInt(payload.substring(0, colonIndex), 10);
    const now = Math.floor(Date.now() / 1000);

    if (now > expires) return null;

    return payload.substring(colonIndex + 1);
  } catch {
    return null;
  }
}
