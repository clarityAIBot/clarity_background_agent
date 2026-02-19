import { logWithContext } from "../../core/log";
import { computeHmacSha256 } from "../../utils";

/**
 * Check if Slack request timestamp is within acceptable window (5 minutes)
 * Prevents replay attacks
 */
export function isSlackTimestampValid(timestamp: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - parseInt(timestamp)) <= 60 * 5;
}

/**
 * Verify Slack signature using HMAC-SHA256
 * @param body - Raw request body string
 * @param timestamp - x-slack-request-timestamp header
 * @param signature - x-slack-signature header
 * @param signingSecret - Slack signing secret
 * @returns true if signature is valid
 */
export async function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string
): Promise<boolean> {
  const sigBaseString = `v0:${timestamp}:${body}`;
  const computedSignature = "v0=" + await computeHmacSha256(signingSecret, sigBaseString);
  return computedSignature === signature;
}

/**
 * Verify Slack request signature from a Request object
 * Extracts headers and validates the signature using HMAC-SHA256
 *
 * @param body - Raw request body string
 * @param request - The incoming Request object
 * @param signingSecret - Slack signing secret
 * @returns true if signature is valid
 */
export async function verifySlackRequestSignature(
  body: string,
  request: Request,
  signingSecret: string
): Promise<boolean> {
  const timestamp = request.headers.get("x-slack-request-timestamp");
  const signature = request.headers.get("x-slack-signature");

  if (!timestamp || !signature) {
    logWithContext("SLACK_SIGNATURE", "Missing signature headers");
    return false;
  }

  if (!isSlackTimestampValid(timestamp)) {
    logWithContext("SLACK_SIGNATURE", "Request timestamp too old");
    return false;
  }

  const isValid = await verifySlackSignature(body, timestamp, signature, signingSecret);

  if (!isValid) {
    logWithContext("SLACK_SIGNATURE", "Invalid signature");
  }

  return isValid;
}
