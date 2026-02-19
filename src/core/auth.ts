import { logWithContext } from "./log";
import { AuthService } from "../services/auth-service";
import { getDb } from "../db/client";
import type { Env } from "./types";

/**
 * Session-based authentication using JWT tokens in cookies.
 * Validates user session and returns user info if authenticated.
 */
export async function validateSession(
  request: Request,
  env: Env
): Promise<{ authenticated: boolean; userId?: string; email?: string; isSuperAdmin?: boolean }> {
  try {
    // Extract token from cookies
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) {
      logWithContext('AUTH', 'No cookies found');
      return { authenticated: false };
    }

    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, value] = cookie.trim().split('=');
      acc[key] = value;
      return acc;
    }, {} as Record<string, string>);

    const token = cookies['clarity_session'];
    if (!token) {
      logWithContext('AUTH', 'No session token in cookies');
      return { authenticated: false };
    }

    // Check if JWT_SECRET is configured
    if (!env.JWT_SECRET) {
      logWithContext('AUTH', 'JWT_SECRET not configured');
      return { authenticated: false };
    }

    // Initialize AuthService with all required parameters
    const db = getDb(env);
    const authService = new AuthService(
      db,
      env.ENCRYPTION_KEY || 'default-encryption-key',
      env.JWT_SECRET,
      env.GOOGLE_CLIENT_ID || '',
      env.GOOGLE_CLIENT_SECRET || ''
    );

    const user = await authService.verifySession(token);

    if (user) {
      logWithContext('AUTH', `Session authenticated for user: ${user.id}`);
      return {
        authenticated: true,
        userId: user.id,
        email: user.email,
        isSuperAdmin: user.isSuperAdmin
      };
    }

    logWithContext('AUTH', 'Invalid session token');
    return { authenticated: false };
  } catch (error) {
    logWithContext('AUTH', `Session validation error: ${error}`);
    return { authenticated: false };
  }
}

/**
 * Returns 401 response if not authorized
 */
export function unauthorizedResponse(request: Request): Response {
  const acceptHeader = request.headers.get('Accept') || '';

  // Return JSON for API requests
  if (acceptHeader.includes('application/json')) {
    return new Response(JSON.stringify({
      error: 'Unauthorized',
      message: 'Authentication required. Please sign in with Google.'
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Return HTML for browser requests - redirect to login
  return new Response(`
<!DOCTYPE html>
<html>
<head>
    <title>Authentication Required</title>
    <meta http-equiv="refresh" content="0;url=/">
    <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
    <p>Redirecting to login...</p>
</body>
</html>`, {
    status: 401,
    headers: { 'Content-Type': 'text/html' }
  });
}
