import jwt from '@tsndr/cloudflare-worker-jwt';
import { logWithContext } from './log';

// Encryption key cache
let cachedEncryptionKey: CryptoKey | null = null;
let cachedKeySource: string | null = null;

/**
 * Derive encryption key from ENCRYPTION_KEY environment variable.
 * Key must be a 32-character string (256-bit) or 64-character hex string.
 */
async function getEncryptionKey(encryptionKey: string): Promise<CryptoKey> {
  if (cachedEncryptionKey && cachedKeySource === encryptionKey) {
    return cachedEncryptionKey;
  }

  let keyBytes: Uint8Array;
  if (encryptionKey.length === 32) {
    keyBytes = new TextEncoder().encode(encryptionKey);
  } else if (encryptionKey.length === 64) {
    // Hex-encoded 32-byte key
    keyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      keyBytes[i] = parseInt(encryptionKey.substring(i * 2, i * 2 + 2), 16);
    }
  } else {
    throw new Error('ENCRYPTION_KEY must be 32 characters or 64 hex characters');
  }

  // Import key with both encrypt and decrypt permissions
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  cachedEncryptionKey = key;
  cachedKeySource = encryptionKey;

  return key;
}

/**
 * Encrypt sensitive data using AES-256-GCM.
 * @param text - The plaintext to encrypt
 * @param encryptionKey - ENCRYPTION_KEY from environment (required)
 * @returns Base64-encoded ciphertext (IV prepended)
 */
export async function encrypt(text: string, encryptionKey?: string): Promise<string> {
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY is required for encryption');
  }

  logWithContext('ENCRYPTION', 'Starting encryption process');

  const key = await getEncryptionKey(encryptionKey);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(text);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encodedText
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  logWithContext('ENCRYPTION', 'Encryption completed successfully');
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt data encrypted with AES-256-GCM.
 * @param encryptedText - Base64-encoded ciphertext (IV prepended)
 * @param encryptionKey - ENCRYPTION_KEY from environment (required)
 * @returns Decrypted plaintext
 */
export async function decrypt(encryptedText: string, encryptionKey?: string): Promise<string> {
  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY is required for decryption');
  }

  logWithContext('DECRYPTION', 'Starting decryption process');

  const key = await getEncryptionKey(encryptionKey);

  const combined = new Uint8Array(
    atob(encryptedText)
      .split('')
      .map(char => char.charCodeAt(0))
  );

  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );

  const result = new TextDecoder().decode(decrypted);
  logWithContext('DECRYPTION', 'Decryption completed successfully');
  return result;
}

// JWT token generation for GitHub App authentication
async function generateAppJWT(appId: string, privateKey: string): Promise<string> {
  logWithContext('JWT', 'Generating App JWT token', { appId });

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iss: appId,
    iat: now - 60, // Issue time (1 minute ago to account for clock skew)
    exp: now + 600, // Expiration time (10 minutes from now)
  };

  logWithContext('JWT', 'JWT payload prepared', { payload });

  // GitHub requires RS256 algorithm for App JWT tokens
  const token = await jwt.sign(payload, privateKey, { algorithm: 'RS256' });

  logWithContext('JWT', 'App JWT token generated successfully');
  return token;
}

// Generate installation access token for making GitHub API calls
export async function generateInstallationToken(
  appId: string,
  privateKey: string,
  installationId: string
): Promise<{ token: string; expires_at: string } | null> {
  logWithContext('INSTALLATION_TOKEN', 'Starting installation token generation', {
    appId,
    installationId
  });

  try {
    // First, generate App JWT
    const appJWT = await generateAppJWT(appId, privateKey);
    logWithContext('INSTALLATION_TOKEN', 'App JWT generated, exchanging for installation token');

    // Exchange for installation access token
    const apiUrl = `https://api.github.com/app/installations/${installationId}/access_tokens`;
    logWithContext('INSTALLATION_TOKEN', 'Calling GitHub API', { url: apiUrl });

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${appJWT}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Worker-GitHub-Integration'
      }
    });

    logWithContext('INSTALLATION_TOKEN', 'GitHub API response received', {
      status: response.status,
      statusText: response.statusText
    });

    if (!response.ok) {
      const errorText = await response.text();
      logWithContext('INSTALLATION_TOKEN', 'Failed to generate installation token', {
        status: response.status,
        error: errorText
      });
      return null;
    }

    const tokenData = await response.json() as { token: string; expires_at: string };
    logWithContext('INSTALLATION_TOKEN', 'Installation token generated successfully', {
      expires_at: tokenData.expires_at
    });

    return tokenData;
  } catch (error) {
    logWithContext('INSTALLATION_TOKEN', 'Error generating installation token', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}