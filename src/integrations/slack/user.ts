import { logWithContext } from "../../core/log";
import { getErrorMessage } from "../../utils";

/**
 * Fetch user info from Slack to get display name and email
 *
 * @param userId - Slack user ID (e.g., U0A7HFG5W0J)
 * @param botToken - Slack bot token
 * @returns User info with name and email, or fallback to userId
 */
export async function getSlackUserInfo(
  userId: string,
  botToken: string
): Promise<{ displayName: string; email?: string }> {
  try {
    const response = await fetch(
      `https://slack.com/api/users.info?user=${userId}`,
      {
        headers: {
          Authorization: `Bearer ${botToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json() as {
      ok: boolean;
      user?: {
        id: string;
        name: string;
        real_name?: string;
        profile?: {
          display_name?: string;
          real_name?: string;
          email?: string;
        };
      };
      error?: string;
    };

    if (!data.ok || !data.user) {
      logWithContext("SLACK_USER", "Failed to fetch user info", {
        userId,
        error: data.error,
      });
      return { displayName: userId };
    }

    // Prefer display_name, then real_name, then username
    const displayName =
      data.user.profile?.display_name ||
      data.user.profile?.real_name ||
      data.user.real_name ||
      data.user.name ||
      userId;

    const email = data.user.profile?.email;

    logWithContext("SLACK_USER", "Fetched user info", {
      userId,
      displayName,
      hasEmail: !!email,
    });

    return { displayName, email };
  } catch (error) {
    logWithContext("SLACK_USER", "Error fetching user info", {
      error: getErrorMessage(error),
      userId,
    });
    return { displayName: userId };
  }
}
