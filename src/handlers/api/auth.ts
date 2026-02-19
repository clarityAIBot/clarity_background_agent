import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getDb } from '../../db/client';
import { AppConfigRepository } from '../../db/repositories';
import { AuthService } from '../../services/auth-service';
import { logWithContext } from '../../core/log';
import type { Env } from '../../core/types';

const app = new Hono<{ Bindings: Env }>();

// Cookie settings
const SESSION_COOKIE_NAME = 'clarity_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

// Helper to get AuthService instance
function getAuthService(env: Env): AuthService {
    const db = getDb(env);

    if (!env.ENCRYPTION_KEY) {
        throw new Error('ENCRYPTION_KEY is required');
    }
    if (!env.JWT_SECRET) {
        throw new Error('JWT_SECRET is required');
    }
    if (!env.GOOGLE_CLIENT_ID) {
        throw new Error('GOOGLE_CLIENT_ID is required');
    }
    if (!env.GOOGLE_CLIENT_SECRET) {
        throw new Error('GOOGLE_CLIENT_SECRET is required');
    }

    return new AuthService(
        db,
        env.ENCRYPTION_KEY,
        env.JWT_SECRET,
        env.GOOGLE_CLIENT_ID,
        env.GOOGLE_CLIENT_SECRET,
    );
}

// Helper to get auth config from system defaults
async function getAuthConfig(env: Env) {
    const db = getDb(env);
    const repo = new AppConfigRepository(db);
    const systemDefaults = await repo.getSystemDefaultsConfig();
    return systemDefaults?.auth;
}

// Disable caching for all auth routes
app.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
});

// GET /api/auth/google - Redirect to Google OAuth
app.get('/google', async (c) => {
    logWithContext('AUTH', 'Starting Google OAuth flow');

    try {
        const authService = getAuthService(c.env);
        const url = new URL(c.req.url);
        const redirectUri = `${url.origin}/api/auth/callback`;

        // Generate state for CSRF protection
        const stateBytes = crypto.getRandomValues(new Uint8Array(16));
        const state = Array.from(stateBytes).map(b => b.toString(16).padStart(2, '0')).join('');

        // Store state in cookie for verification
        setCookie(c, 'oauth_state', state, {
            httpOnly: true,
            secure: url.protocol === 'https:',
            sameSite: 'Lax',
            maxAge: 600, // 10 minutes
            path: '/',
        });

        // Get optional return URL
        const returnUrl = c.req.query('return') || '/';
        setCookie(c, 'oauth_return', returnUrl, {
            httpOnly: true,
            secure: url.protocol === 'https:',
            sameSite: 'Lax',
            maxAge: 600,
            path: '/',
        });

        const authUrl = authService.getGoogleAuthUrl(redirectUri, state);
        logWithContext('AUTH', 'Redirecting to Google', { redirectUri });

        return c.redirect(authUrl);
    } catch (error) {
        logWithContext('AUTH', 'Error starting OAuth flow', {
            error: error instanceof Error ? error.message : String(error),
        });
        return c.json({ error: 'Failed to start OAuth flow' }, 500);
    }
});

// GET /api/auth/callback - Handle Google OAuth callback
app.get('/callback', async (c) => {
    logWithContext('AUTH', 'Handling OAuth callback');

    try {
        const url = new URL(c.req.url);
        const code = c.req.query('code');
        const state = c.req.query('state');
        const error = c.req.query('error');

        // Handle OAuth errors
        if (error) {
            logWithContext('AUTH', 'OAuth error from Google', { error });
            return c.redirect(`/login?error=${encodeURIComponent(error)}`);
        }

        if (!code) {
            logWithContext('AUTH', 'No authorization code received');
            return c.redirect('/login?error=no_code');
        }

        // Verify state for CSRF protection
        const storedState = getCookie(c, 'oauth_state');
        if (!state || state !== storedState) {
            logWithContext('AUTH', 'State mismatch', { received: state, stored: storedState });
            return c.redirect('/login?error=invalid_state');
        }

        // Clear state cookie
        deleteCookie(c, 'oauth_state', { path: '/' });

        const authService = getAuthService(c.env);
        const redirectUri = `${url.origin}/api/auth/callback`;
        const authConfig = await getAuthConfig(c.env);

        // Get client info
        const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for');
        const userAgent = c.req.header('user-agent');

        // Handle OAuth callback
        const result = await authService.handleOAuthCallback(
            code,
            redirectUri,
            authConfig,
            ipAddress,
            userAgent,
        );

        // Set session cookie
        setCookie(c, SESSION_COOKIE_NAME, result.sessionToken, {
            httpOnly: true,
            secure: url.protocol === 'https:',
            sameSite: 'Lax',
            maxAge: COOKIE_MAX_AGE,
            path: '/',
        });

        logWithContext('AUTH', 'OAuth callback successful', {
            userId: result.user.id,
            isNewUser: result.isNewUser,
            isSuperAdmin: result.user.isSuperAdmin,
        });

        // Redirect to return URL or home
        const returnUrl = getCookie(c, 'oauth_return') || '/';
        deleteCookie(c, 'oauth_return', { path: '/' });

        return c.redirect(returnUrl);
    } catch (error) {
        logWithContext('AUTH', 'OAuth callback error', {
            error: error instanceof Error ? error.message : String(error),
        });

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return c.redirect(`/login?error=${encodeURIComponent(errorMessage)}`);
    }
});

// GET /api/auth/me - Get current user
app.get('/me', async (c) => {
    logWithContext('AUTH', 'Getting current user');

    try {
        const token = getCookie(c, SESSION_COOKIE_NAME);

        if (!token) {
            return c.json({ authenticated: false }, 401);
        }

        const authService = getAuthService(c.env);
        const user = await authService.verifySession(token);

        if (!user) {
            // Clear invalid session cookie
            deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
            return c.json({ authenticated: false }, 401);
        }

        // Get user's policy
        const policy = await authService.getUserPolicy(user.id);

        return c.json({
            authenticated: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                pictureUrl: user.pictureUrl,
                isSuperAdmin: user.isSuperAdmin,
                status: user.status,
                lastLoginAt: user.lastLoginAt,
                createdAt: user.createdAt,
            },
            policy: policy ? {
                policyId: policy.policyId,
                statements: policy.statements,
            } : null,
        });
    } catch (error) {
        logWithContext('AUTH', 'Error getting current user', {
            error: error instanceof Error ? error.message : String(error),
        });
        return c.json({ error: 'Failed to get current user' }, 500);
    }
});

// POST /api/auth/logout - Logout current user
app.post('/logout', async (c) => {
    logWithContext('AUTH', 'Logging out user');

    try {
        const token = getCookie(c, SESSION_COOKIE_NAME);

        if (token) {
            const authService = getAuthService(c.env);
            await authService.logout(token);
        }

        // Clear session cookie
        deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });

        return c.json({ success: true });
    } catch (error) {
        logWithContext('AUTH', 'Error during logout', {
            error: error instanceof Error ? error.message : String(error),
        });
        // Still clear the cookie even on error
        deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
        return c.json({ success: true });
    }
});

// POST /api/auth/refresh - Refresh session (extend expiry)
app.post('/refresh', async (c) => {
    logWithContext('AUTH', 'Refreshing session');

    try {
        const token = getCookie(c, SESSION_COOKIE_NAME);

        if (!token) {
            return c.json({ error: 'No session found' }, 401);
        }

        const authService = getAuthService(c.env);
        const user = await authService.verifySession(token);

        if (!user) {
            deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
            return c.json({ error: 'Invalid session' }, 401);
        }

        // Get client info
        const ipAddress = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for');
        const userAgent = c.req.header('user-agent');

        // Delete old session
        await authService.logout(token);

        // Create new session
        const newToken = await authService.createSession(user, ipAddress, userAgent);

        // Set new cookie
        const url = new URL(c.req.url);
        setCookie(c, SESSION_COOKIE_NAME, newToken, {
            httpOnly: true,
            secure: url.protocol === 'https:',
            sameSite: 'Lax',
            maxAge: COOKIE_MAX_AGE,
            path: '/',
        });

        return c.json({ success: true });
    } catch (error) {
        logWithContext('AUTH', 'Error refreshing session', {
            error: error instanceof Error ? error.message : String(error),
        });
        return c.json({ error: 'Failed to refresh session' }, 500);
    }
});

// GET /api/auth/status - Check if Google OAuth is configured
app.get('/status', async (c) => {
    const isConfigured = !!(c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET && c.env.JWT_SECRET);

    return c.json({
        googleOAuthConfigured: isConfigured,
        hasSession: !!getCookie(c, SESSION_COOKIE_NAME),
    });
});

export { app as authApi };
