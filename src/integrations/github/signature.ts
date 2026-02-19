/**
 * GitHub webhook signature verification
 */

import { computeHmacSha256 } from "../../utils";

/**
 * Verify GitHub webhook signature
 * @param payload - Raw webhook payload string
 * @param signature - x-hub-signature-256 header (with "sha256=" prefix)
 * @param secret - GitHub webhook secret
 * @returns true if signature is valid
 */
export async function verifyGitHubSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  if (!signature || !signature.startsWith("sha256=")) {
    return false;
  }

  const expectedHex = signature.replace("sha256=", "");
  const computedHex = await computeHmacSha256(secret, payload);
  return expectedHex === computedHex;
}
