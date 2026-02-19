import { Hono } from 'hono';
import { getDb } from '../../db/client';
import { users, userPolicies, policies } from '../../db/schema';
import { eq, desc, or, ilike, sql } from 'drizzle-orm';
import { logWithContext } from '../../core/log';
import { AuthorizationService } from '../../services/authorization-service';
import type { Env } from '../../core/types';

const app = new Hono<{ Bindings: Env }>();

// Middleware to check if user has permission to manage users
// Requires either: super admin OR users:* action on users/* resource
app.use('/api/users/*', async (c, next) => {
  const auth = (c.req.raw as any).auth;

  if (!auth || !auth.authenticated) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const db = getDb(c.env);
  const authService = new AuthorizationService(db);

  // Check authorization for users management
  // Per ADR-005: Users management requires configure:* action on clarity:config/users resource
  const isAuthorized = await authService.isAuthorized(
    auth.userId,
    'configure:*',
    'clarity:config/users'
  );

  if (!isAuthorized) {
    return c.json({
      error: 'Forbidden',
      message: 'Insufficient permissions to manage users. Requires users:* action on users/* resource.'
    }, 403);
  }

  return next();
});

/**
 * GET /api/users
 * List all users (admin or super admin only)
 */
app.get('/api/users', async (c) => {
  try {
    const db = getDb(c.env);

    // Get query parameters for filtering/search
    const search = c.req.query('search') || '';
    const status = c.req.query('status') as 'active' | 'inactive' | undefined;

    // Build query with filters
    const conditions = [];

    if (search) {
      conditions.push(
        or(
          ilike(users.email, `%${search}%`),
          ilike(users.name, `%${search}%`)
        )
      );
    }

    if (status) {
      conditions.push(eq(users.status, status));
    }

    // Execute query
    const query = db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      pictureUrl: users.pictureUrl,
      isSuperAdmin: users.isSuperAdmin,
      status: users.status,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
    }).from(users);

    const allUsers = conditions.length > 0
      ? await query.where(sql`${sql.join(conditions, sql` AND `)}`).orderBy(desc(users.createdAt))
      : await query.orderBy(desc(users.createdAt));

    // Get policies for each user
    const usersWithPolicies = await Promise.all(
      allUsers.map(async (user) => {
        const userPolicyRecords = await db
          .select({
            policyId: userPolicies.policyId,
            policyName: policies.name,
            enabled: userPolicies.enabled,
            expiresAt: userPolicies.expiresAt,
          })
          .from(userPolicies)
          .innerJoin(policies, eq(userPolicies.policyId, policies.id))
          .where(eq(userPolicies.userId, user.id));

        return {
          ...user,
          policies: userPolicyRecords,
        };
      })
    );

    return c.json({
      users: usersWithPolicies,
      total: usersWithPolicies.length,
    });
  } catch (error) {
    logWithContext('API', `Failed to list users: ${error}`);
    return c.json({ error: 'Failed to list users' }, 500);
  }
});

/**
 * GET /api/users/stats
 * Get user statistics
 */
app.get('/api/users/stats', async (c) => {
  try {
    const db = getDb(c.env);

    const [stats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${users.status} = 'active')::int`,
        inactive: sql<number>`count(*) filter (where ${users.status} = 'inactive')::int`,
        superAdmins: sql<number>`count(*) filter (where ${users.isSuperAdmin} = true)::int`,
      })
      .from(users);

    return c.json(stats);
  } catch (error) {
    logWithContext('API', `Failed to get user stats: ${error}`);
    return c.json({ error: 'Failed to get user stats' }, 500);
  }
});

/**
 * GET /api/users/:id
 * Get a specific user by ID (super admin only)
 */
app.get('/api/users/:id', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.req.param('id');

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        pictureUrl: users.pictureUrl,
        googleId: users.googleId,
        isSuperAdmin: users.isSuperAdmin,
        status: users.status,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, userId));

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Get user's policies
    const userPolicyRecords = await db
      .select({
        id: userPolicies.id,
        policyId: userPolicies.policyId,
        policyName: policies.name,
        policyDescription: policies.description,
        enabled: userPolicies.enabled,
        expiresAt: userPolicies.expiresAt,
        createdBy: userPolicies.createdBy,
        createdAt: userPolicies.createdAt,
      })
      .from(userPolicies)
      .innerJoin(policies, eq(userPolicies.policyId, policies.id))
      .where(eq(userPolicies.userId, userId));

    return c.json({
      user: {
        ...user,
        policies: userPolicyRecords,
      },
    });
  } catch (error) {
    logWithContext('API', `Failed to get user: ${error}`);
    return c.json({ error: 'Failed to get user' }, 500);
  }
});

/**
 * PATCH /api/users/:id/status
 * Update user status (activate/deactivate)
 */
app.patch('/api/users/:id/status', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.req.param('id');
    const { status } = await c.req.json<{ status: 'active' | 'inactive' }>();

    if (!status || !['active', 'inactive'].includes(status)) {
      return c.json({ error: 'Invalid status. Must be "active" or "inactive"' }, 400);
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        status: users.status,
      });

    if (!updatedUser) {
      return c.json({ error: 'User not found' }, 404);
    }

    logWithContext('API', `User ${updatedUser.email} status updated to ${status}`);

    return c.json({
      success: true,
      user: updatedUser,
    });
  } catch (error) {
    logWithContext('API', `Failed to update user status: ${error}`);
    return c.json({ error: 'Failed to update user status' }, 500);
  }
});

/**
 * PATCH /api/users/:id/super-admin
 * Grant or revoke super admin privileges
 */
app.patch('/api/users/:id/super-admin', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.req.param('id');
    const { isSuperAdmin } = await c.req.json<{ isSuperAdmin: boolean }>();

    if (typeof isSuperAdmin !== 'boolean') {
      return c.json({ error: 'Invalid isSuperAdmin value. Must be boolean' }, 400);
    }

    const [updatedUser] = await db
      .update(users)
      .set({
        isSuperAdmin,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({
        id: users.id,
        email: users.email,
        isSuperAdmin: users.isSuperAdmin,
      });

    if (!updatedUser) {
      return c.json({ error: 'User not found' }, 404);
    }

    logWithContext('API', `User ${updatedUser.email} super admin status updated to ${isSuperAdmin}`);

    return c.json({
      success: true,
      user: updatedUser,
    });
  } catch (error) {
    logWithContext('API', `Failed to update super admin status: ${error}`);
    return c.json({ error: 'Failed to update super admin status' }, 500);
  }
});

/**
 * POST /api/users/:id/policies
 * Assign a policy to a user
 */
app.post('/api/users/:id/policies', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.req.param('id');
    const { policyId, expiresAt, createdBy } = await c.req.json<{
      policyId: string;
      expiresAt?: string;
      createdBy?: string;
    }>();

    if (!policyId) {
      return c.json({ error: 'Policy ID is required' }, 400);
    }

    // Check if user exists
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Check if policy exists
    const [policy] = await db.select().from(policies).where(eq(policies.id, policyId));
    if (!policy) {
      return c.json({ error: 'Policy not found' }, 404);
    }

    // Check if user already has this policy
    const [existing] = await db
      .select()
      .from(userPolicies)
      .where(
        sql`${userPolicies.userId} = ${userId} AND ${userPolicies.policyId} = ${policyId}`
      );

    if (existing) {
      return c.json({ error: 'User already has this policy' }, 400);
    }

    // Create user policy assignment
    const [newUserPolicy] = await db
      .insert(userPolicies)
      .values({
        userId,
        policyId,
        enabled: true,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        createdBy,
      })
      .returning();

    // If assigning super_admin policy, update user's isSuperAdmin flag
    if (policyId === 'super_admin') {
      await db
        .update(users)
        .set({
          isSuperAdmin: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      logWithContext('API', `User ${user.email} granted super admin privileges via policy assignment`);
    }

    logWithContext('API', `Policy ${policyId} assigned to user ${user.email}`);

    return c.json({
      success: true,
      userPolicy: newUserPolicy,
    });
  } catch (error) {
    logWithContext('API', `Failed to assign policy: ${error}`);
    return c.json({ error: 'Failed to assign policy' }, 500);
  }
});

/**
 * DELETE /api/users/:id/policies/:policyId
 * Remove a policy from a user
 */
app.delete('/api/users/:id/policies/:policyId', async (c) => {
  try {
    const db = getDb(c.env);
    const userId = c.req.param('id');
    const policyId = c.req.param('policyId');

    // Get user for logging
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    const [deleted] = await db
      .delete(userPolicies)
      .where(
        sql`${userPolicies.userId} = ${userId} AND ${userPolicies.policyId} = ${policyId}`
      )
      .returning({
        userId: userPolicies.userId,
        policyId: userPolicies.policyId,
      });

    if (!deleted) {
      return c.json({ error: 'User policy not found' }, 404);
    }

    // If removing super_admin policy, update user's isSuperAdmin flag
    if (policyId === 'super_admin') {
      await db
        .update(users)
        .set({
          isSuperAdmin: false,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      logWithContext('API', `User ${user.email} revoked super admin privileges via policy removal`);
    }

    logWithContext('API', `Policy ${policyId} removed from user ${user.email}`);

    return c.json({
      success: true,
      message: 'Policy removed from user',
    });
  } catch (error) {
    logWithContext('API', `Failed to remove policy: ${error}`);
    return c.json({ error: 'Failed to remove policy' }, 500);
  }
});

export default app;
