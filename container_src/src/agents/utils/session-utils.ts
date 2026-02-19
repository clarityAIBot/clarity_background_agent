/**
 * Session Utilities - Shared session blob handling for agent strategies.
 *
 * ADR-001: Session Blob Persistence
 *
 * These utilities handle:
 * - Session file restoration from compressed blobs
 * - Session file extraction to compressed blobs
 * - Session directory management
 *
 * Used by: ClaudeCodeStrategy, OpenCodeStrategy (future)
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { createLogger } from '../../logger.js';

const logger = createLogger('SessionUtils');

// Promisified compression functions
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Get the session directory for Claude SDK.
 * SDK stores sessions in ~/.claude/projects/<encoded-cwd>/
 *
 * @param workspaceDir - Optional workspace directory override (defaults to cwd)
 */
export function getClaudeSessionDir(workspaceDir?: string): string {
  const cwd = workspaceDir || process.cwd();
  const encodedCwd = cwd.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encodedCwd);
}

/**
 * Get the session directory for OpenCode.
 * TODO: Update when OpenCode session storage path is confirmed.
 *
 * @param workspaceDir - Optional workspace directory override (defaults to cwd)
 */
export function getOpenCodeSessionDir(workspaceDir?: string): string {
  // Placeholder - update when OpenCode session path is known
  const cwd = workspaceDir || process.cwd();
  const encodedCwd = cwd.replace(/\//g, '-');
  return path.join(os.homedir(), '.opencode', 'sessions', encodedCwd);
}

/**
 * Restore a session from a compressed blob.
 *
 * @param sessionId - The session ID (used as filename)
 * @param blob - Base64-encoded gzipped session data
 * @param sessionDir - Directory to write the session file
 * @returns true if restoration succeeded, false otherwise
 */
export async function restoreSessionFromBlob(
  sessionId: string,
  blob: string,
  sessionDir: string
): Promise<boolean> {
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  logger.log('SESSION', 'Restoring session from blob', {
    sessionId,
    blobLength: blob.length,
    sessionDir,
  });

  try {
    // Ensure session directory exists
    await fs.mkdir(sessionDir, { recursive: true });

    // Decode base64 and decompress
    const compressed = Buffer.from(blob, 'base64');
    const content = await gunzipAsync(compressed);

    // Write session file
    await fs.writeFile(sessionPath, content);

    logger.log('SESSION', 'Session restored successfully', {
      sessionId,
      compressedSize: compressed.length,
      uncompressedSize: content.length,
      sessionPath,
    });

    return true;
  } catch (error) {
    logger.log('SESSION', 'Failed to restore session', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Extract a session to a compressed blob.
 *
 * @param sessionId - The session ID (used as filename)
 * @param sessionDir - Directory containing the session file
 * @returns Base64-encoded gzipped session data, or undefined if extraction failed
 */
export async function extractSessionToBlob(
  sessionId: string,
  sessionDir: string
): Promise<string | undefined> {
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  try {
    const content = await fs.readFile(sessionPath);
    const compressed = await gzipAsync(content);
    const blob = compressed.toString('base64');

    logger.log('SESSION', 'Session blob extracted', {
      sessionId,
      uncompressedSize: content.length,
      compressedSize: compressed.length,
      compressionRatio: ((1 - compressed.length / content.length) * 100).toFixed(1) + '%',
      base64Length: blob.length,
    });

    return blob;
  } catch (error) {
    logger.log('SESSION', 'Failed to extract session blob', {
      sessionId,
      sessionPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * List session files in a directory.
 *
 * @param sessionDir - Directory to search
 * @returns Array of session IDs (filenames without .jsonl extension)
 */
export async function listSessionFiles(sessionDir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(sessionDir);
    return files
      .filter(f => f.endsWith('.jsonl'))
      .map(f => f.replace('.jsonl', ''));
  } catch {
    return [];
  }
}

/**
 * Get stats for a session file.
 *
 * @param sessionId - The session ID
 * @param sessionDir - Directory containing the session file
 * @returns Session file stats or undefined if not found
 */
export async function getSessionStats(
  sessionId: string,
  sessionDir: string
): Promise<{ sizeBytes: number; sizeMB: string } | undefined> {
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  try {
    const stats = await fs.stat(sessionPath);
    return {
      sizeBytes: stats.size,
      sizeMB: (stats.size / 1024 / 1024).toFixed(2),
    };
  } catch {
    return undefined;
  }
}

/**
 * Delete a session file.
 *
 * @param sessionId - The session ID
 * @param sessionDir - Directory containing the session file
 * @returns true if deletion succeeded, false otherwise
 */
export async function deleteSession(
  sessionId: string,
  sessionDir: string
): Promise<boolean> {
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  try {
    await fs.unlink(sessionPath);
    logger.log('SESSION', 'Session file deleted', { sessionId, sessionPath });
    return true;
  } catch (error) {
    logger.log('SESSION', 'Failed to delete session file', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
