import jwt from '@tsndr/cloudflare-worker-jwt';
import { eq, count } from 'drizzle-orm';
import { encrypt, decrypt } from '../core/crypto';
import { logWithContext } from '../core/log';
import type { DrizzleDb } from '../db/client';
import {
    users,
    sessions,
    userPolicies,
    policies,
    DEFAULT_POLICIES,
    type User,
    type NewUser,
    type Session,
    type OAuthTokens,
} from '../db/schema';

// Google OAuth endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Google OAuth scopes
const GOOGLE_SCOPES = [
    'openid',
    'email',
    'profile',
].join(' ');

// Session duration (7 days)
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

// Token refresh threshold (5 minutes before expiry)
const TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

export interface GoogleTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    scope: string;
    id_token?: string;
}

export interface GoogleUserInfo {
    id: string;
    email: string;
    verified_email: boolean;
    name: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
}

export interface AuthConfig {
    allowedDomains?: string[];
    allowedEmails?: string[];
    defaultPolicyId?: string;
}

export interface SessionPayload {
    sub: string;        // User ID
    email: string;
    name?: string;
    isSuperAdmin: boolean;
    iat: number;
    exp: number;
}

export interface AuthResult {
    user: User;
    sessionToken: string;
    isNewUser: boolean;
}

export class AuthService {
    constructor(
        private db: DrizzleDb,
        private encryptionKey: string,
        private jwtSecret: string,
        private googleClientId: string,
        private googleClientSecret: string,
    ) {}

    /**
     * Generate Google OAuth authorization URL
     */
    getGoogleAuthUrl(redirectUri: string, state?: string): string {
        const params = new URLSearchParams({
            client_id: this.googleClientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: GOOGLE_SCOPES,
            access_type: 'offline',  // Request refresh token
            prompt: 'consent',       // Force consent to get refresh token
        });

        if (state) {
            params.set('state', state);
        }

        return `${GOOGLE_AUTH_URL}?${params.toString()}`;
    }

    /**
     * Exchange authorization code for tokens
     */
    async exchangeCodeForTokens(code: string, redirectUri: string): Promise<GoogleTokenResponse> {
        logWithContext('AUTH', 'Exchanging code for tokens');

        const response = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: this.googleClientId,
                client_secret: this.googleClientSecret,
                code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            logWithContext('AUTH', 'Token exchange failed', { status: response.status, error });
            throw new Error(`Token exchange failed: ${error}`);
        }

        const tokens = await response.json() as GoogleTokenResponse;
        logWithContext('AUTH', 'Token exchange successful', { hasRefreshToken: !!tokens.refresh_token });
        return tokens;
    }

    /**
     * Refresh access token using refresh token
     */
    async refreshAccessToken(refreshTokenEncrypted: string): Promise<GoogleTokenResponse> {
        logWithContext('AUTH', 'Refreshing access token');

        const refreshToken = await decrypt(refreshTokenEncrypted, this.encryptionKey);

        const response = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: this.googleClientId,
                client_secret: this.googleClientSecret,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            logWithContext('AUTH', 'Token refresh failed', { status: response.status, error });
            throw new Error(`Token refresh failed: ${error}`);
        }

        const tokens = await response.json() as GoogleTokenResponse;
        logWithContext('AUTH', 'Token refresh successful');
        return tokens;
    }

    /**
     * Get user info from Google using access token
     */
    async getGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
        logWithContext('AUTH', 'Fetching Google user info');

        const response = await fetch(GOOGLE_USERINFO_URL, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
            },
        });

        if (!response.ok) {
            const error = await response.text();
            logWithContext('AUTH', 'Failed to get user info', { status: response.status, error });
            throw new Error(`Failed to get user info: ${error}`);
        }

        const userInfo = await response.json() as GoogleUserInfo;
        logWithContext('AUTH', 'User info fetched', { email: userInfo.email });
        return userInfo;
    }

    /**
     * Check if user is allowed to login based on AuthConfig
     */
    isUserAllowed(email: string, authConfig?: AuthConfig): boolean {
        if (!authConfig) return true;

        const { allowedDomains, allowedEmails } = authConfig;

        // If specific emails are allowed, check first
        if (allowedEmails?.length && allowedEmails.includes(email)) {
            return true;
        }

        // If domains are restricted, check domain
        if (allowedDomains?.length) {
            const domain = email.split('@')[1];
            return allowedDomains.includes(domain);
        }

        // No restrictions - allow all
        return true;
    }

    /**
     * Check if this is the first user (will become super admin)
     */
    async isFirstUser(): Promise<boolean> {
        const result = await this.db.select({ count: count() }).from(users);
        return result[0].count === 0;
    }

    /**
     * Find or create user from Google OAuth
     */
    async findOrCreateUser(
        googleUserInfo: GoogleUserInfo,
        tokens: GoogleTokenResponse,
        authConfig?: AuthConfig,
    ): Promise<{ user: User; isNewUser: boolean }> {
        logWithContext('AUTH', 'Finding or creating user', { email: googleUserInfo.email });

        // Check if user is allowed
        if (!this.isUserAllowed(googleUserInfo.email, authConfig)) {
            throw new Error(`User ${googleUserInfo.email} is not allowed to login`);
        }

        // Check if user exists
        const existingUsers = await this.db
            .select()
            .from(users)
            .where(eq(users.email, googleUserInfo.email))
            .limit(1);

        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

        // Encrypt tokens
        const accessTokenEncrypted = await encrypt(tokens.access_token, this.encryptionKey);
        const refreshTokenEncrypted = tokens.refresh_token
            ? await encrypt(tokens.refresh_token, this.encryptionKey)
            : undefined;

        const oauthTokens: OAuthTokens = {
            google: {
                accessTokenEncrypted,
                refreshTokenEncrypted,
                expiresAt,
                scope: tokens.scope,
            },
        };

        if (existingUsers.length > 0) {
            // Update existing user
            const existingUser = existingUsers[0];

            // Merge with existing tokens (preserve refresh token if new one not provided)
            const existingOAuth = existingUser.oauthTokens?.google;
            if (existingOAuth?.refreshTokenEncrypted && !refreshTokenEncrypted) {
                oauthTokens.google.refreshTokenEncrypted = existingOAuth.refreshTokenEncrypted;
            }

            await this.db
                .update(users)
                .set({
                    name: googleUserInfo.name,
                    pictureUrl: googleUserInfo.picture,
                    googleId: googleUserInfo.id,
                    oauthTokens,
                    lastLoginAt: new Date(),
                    updatedAt: new Date(),
                })
                .where(eq(users.id, existingUser.id));

            const updated = await this.db
                .select()
                .from(users)
                .where(eq(users.id, existingUser.id))
                .limit(1);

            logWithContext('AUTH', 'Existing user updated', { userId: existingUser.id });
            return { user: updated[0], isNewUser: false };
        }

        // Create new user
        const isFirst = await this.isFirstUser();
        const defaultPolicyId = authConfig?.defaultPolicyId || 'developer';

        const newUser: NewUser = {
            email: googleUserInfo.email,
            name: googleUserInfo.name,
            pictureUrl: googleUserInfo.picture,
            googleId: googleUserInfo.id,
            oauthTokens,
            isSuperAdmin: isFirst,  // First user becomes super admin
            status: 'active',
            lastLoginAt: new Date(),
        };

        const inserted = await this.db
            .insert(users)
            .values(newUser)
            .returning();

        const user = inserted[0];
        logWithContext('AUTH', 'New user created', { userId: user.id, isSuperAdmin: isFirst });

        // Assign default policy
        const policyId = isFirst ? 'super_admin' : defaultPolicyId;
        await this.assignPolicy(user.id, policyId, 'system');

        return { user, isNewUser: true };
    }

    /**
     * Assign a policy to a user
     */
    async assignPolicy(userId: string, policyId: string, assignedBy: string): Promise<void> {
        logWithContext('AUTH', 'Assigning policy', { userId, policyId });

        // Check if policy exists, seed if needed
        const existingPolicy = await this.db
            .select()
            .from(policies)
            .where(eq(policies.id, policyId))
            .limit(1);

        if (existingPolicy.length === 0) {
            // Seed default policies
            await this.seedDefaultPolicies();
        }

        // Check if assignment already exists
        const existing = await this.db
            .select()
            .from(userPolicies)
            .where(eq(userPolicies.userId, userId))
            .limit(1);

        if (existing.length > 0) {
            // Update existing assignment
            await this.db
                .update(userPolicies)
                .set({
                    policyId,
                    createdBy: assignedBy,
                    updatedAt: new Date(),
                })
                .where(eq(userPolicies.userId, userId));
        } else {
            // Create new assignment
            await this.db.insert(userPolicies).values({
                userId,
                policyId,
                createdBy: assignedBy,
            });
        }
    }

    /**
     * Seed default policies if they don't exist
     */
    async seedDefaultPolicies(): Promise<void> {
        logWithContext('AUTH', 'Seeding default policies');

        for (const [id, policy] of Object.entries(DEFAULT_POLICIES)) {
            const exists = await this.db
                .select()
                .from(policies)
                .where(eq(policies.id, id))
                .limit(1);

            if (exists.length === 0) {
                await this.db.insert(policies).values({
                    id: policy.id,
                    name: policy.name,
                    description: policy.description,
                    statements: policy.statements,
                    isBuiltIn: policy.isBuiltIn,
                    createdBy: 'system',
                });
                logWithContext('AUTH', 'Policy seeded', { id });
            }
        }
    }

    /**
     * Create a session for a user
     */
    async createSession(user: User, ipAddress?: string, userAgent?: string): Promise<string> {
        logWithContext('AUTH', 'Creating session', { userId: user.id });

        const now = Math.floor(Date.now() / 1000);
        const exp = now + Math.floor(SESSION_DURATION_MS / 1000);

        const payload: SessionPayload = {
            sub: user.id,
            email: user.email,
            name: user.name || undefined,
            isSuperAdmin: user.isSuperAdmin,
            iat: now,
            exp,
        };

        // Sign JWT
        const token = await jwt.sign(payload, this.jwtSecret, { algorithm: 'HS256' });

        // Hash token for storage
        const tokenBytes = new TextEncoder().encode(token);
        const hashBuffer = await crypto.subtle.digest('SHA-256', tokenBytes);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        // Store session
        await this.db.insert(sessions).values({
            userId: user.id,
            tokenHash,
            expiresAt: new Date(exp * 1000),
            ipAddress,
            userAgent,
        });

        logWithContext('AUTH', 'Session created', { userId: user.id, expiresAt: new Date(exp * 1000).toISOString() });
        return token;
    }

    /**
     * Verify session token and return user
     */
    async verifySession(token: string): Promise<User | null> {
        try {
            // Verify JWT signature
            const isValid = await jwt.verify(token, this.jwtSecret, { algorithm: 'HS256' });
            if (!isValid) {
                logWithContext('AUTH', 'Invalid JWT signature');
                return null;
            }

            const payload = jwt.decode(token).payload as SessionPayload;

            // Check expiration
            if (payload.exp < Math.floor(Date.now() / 1000)) {
                logWithContext('AUTH', 'Token expired');
                return null;
            }

            // Hash token and check session exists
            const tokenBytes = new TextEncoder().encode(token);
            const hashBuffer = await crypto.subtle.digest('SHA-256', tokenBytes);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            const sessionResult = await this.db
                .select()
                .from(sessions)
                .where(eq(sessions.tokenHash, tokenHash))
                .limit(1);

            if (sessionResult.length === 0) {
                logWithContext('AUTH', 'Session not found in database');
                return null;
            }

            const session = sessionResult[0];

            // Check session expiration
            if (session.expiresAt < new Date()) {
                logWithContext('AUTH', 'Session expired in database');
                return null;
            }

            // Get user
            const userResult = await this.db
                .select()
                .from(users)
                .where(eq(users.id, payload.sub))
                .limit(1);

            if (userResult.length === 0) {
                logWithContext('AUTH', 'User not found');
                return null;
            }

            const user = userResult[0];

            // Check user is active
            if (user.status !== 'active') {
                logWithContext('AUTH', 'User is not active', { status: user.status });
                return null;
            }

            return user;
        } catch (error) {
            logWithContext('AUTH', 'Session verification error', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * Get user's Google access token, refreshing if needed
     */
    async getGoogleAccessToken(user: User): Promise<string | null> {
        const googleTokens = user.oauthTokens?.google;
        if (!googleTokens) {
            logWithContext('AUTH', 'No Google tokens found for user', { userId: user.id });
            return null;
        }

        // Check if token needs refresh
        const expiresAt = googleTokens.expiresAt ? new Date(googleTokens.expiresAt) : null;
        const needsRefresh = !expiresAt || (expiresAt.getTime() - Date.now() < TOKEN_REFRESH_THRESHOLD_MS);

        if (needsRefresh && googleTokens.refreshTokenEncrypted) {
            logWithContext('AUTH', 'Refreshing Google access token', { userId: user.id });

            try {
                const newTokens = await this.refreshAccessToken(googleTokens.refreshTokenEncrypted);

                // Update user with new tokens
                const newExpiresAt = new Date(Date.now() + newTokens.expires_in * 1000).toISOString();
                const newAccessTokenEncrypted = await encrypt(newTokens.access_token, this.encryptionKey);

                const updatedOAuthTokens: OAuthTokens = {
                    ...user.oauthTokens,
                    google: {
                        ...googleTokens,
                        accessTokenEncrypted: newAccessTokenEncrypted,
                        expiresAt: newExpiresAt,
                    },
                };

                await this.db
                    .update(users)
                    .set({
                        oauthTokens: updatedOAuthTokens,
                        updatedAt: new Date(),
                    })
                    .where(eq(users.id, user.id));

                return newTokens.access_token;
            } catch (error) {
                logWithContext('AUTH', 'Failed to refresh token', {
                    error: error instanceof Error ? error.message : String(error),
                });
                // Fall through to try existing token
            }
        }

        // Decrypt and return existing token
        try {
            return await decrypt(googleTokens.accessTokenEncrypted, this.encryptionKey);
        } catch (error) {
            logWithContext('AUTH', 'Failed to decrypt access token', {
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * Logout - delete session
     */
    async logout(token: string): Promise<void> {
        const tokenBytes = new TextEncoder().encode(token);
        const hashBuffer = await crypto.subtle.digest('SHA-256', tokenBytes);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const tokenHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
        logWithContext('AUTH', 'Session deleted');
    }

    /**
     * Get user by ID
     */
    async getUserById(userId: string): Promise<User | null> {
        const result = await this.db
            .select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        return result.length > 0 ? result[0] : null;
    }

    /**
     * Get user's assigned policy
     */
    async getUserPolicy(userId: string): Promise<{ policyId: string; statements: any } | null> {
        const result = await this.db
            .select({
                policyId: userPolicies.policyId,
                statements: policies.statements,
            })
            .from(userPolicies)
            .innerJoin(policies, eq(userPolicies.policyId, policies.id))
            .where(eq(userPolicies.userId, userId))
            .limit(1);

        return result.length > 0 ? result[0] : null;
    }

    /**
     * Handle full OAuth callback flow
     */
    async handleOAuthCallback(
        code: string,
        redirectUri: string,
        authConfig?: AuthConfig,
        ipAddress?: string,
        userAgent?: string,
    ): Promise<AuthResult> {
        // Exchange code for tokens
        const tokens = await this.exchangeCodeForTokens(code, redirectUri);

        // Get user info from Google
        const googleUserInfo = await this.getGoogleUserInfo(tokens.access_token);

        // Find or create user
        const { user, isNewUser } = await this.findOrCreateUser(googleUserInfo, tokens, authConfig);

        // Create session
        const sessionToken = await this.createSession(user, ipAddress, userAgent);

        return { user, sessionToken, isNewUser };
    }
}
