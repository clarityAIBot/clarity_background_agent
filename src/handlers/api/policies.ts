import { Hono } from 'hono';
import { getDb } from '../../db/client';
import { policies } from '../../db/schema';
import { desc } from 'drizzle-orm';
import { logWithContext } from '../../core/log';
import type { Env } from '../../core/types';

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /api/policies
 * List all available policies (for assignment to users)
 */
app.get('/api/policies', async (c) => {
  try {
    const db = getDb(c.env);

    const allPolicies = await db
      .select({
        id: policies.id,
        name: policies.name,
        description: policies.description,
        isBuiltIn: policies.isBuiltIn,
        createdAt: policies.createdAt,
      })
      .from(policies)
      .orderBy(desc(policies.isBuiltIn), policies.name);

    return c.json({
      policies: allPolicies,
      total: allPolicies.length,
    });
  } catch (error) {
    logWithContext('API', `Failed to list policies: ${error}`);
    return c.json({ error: 'Failed to list policies' }, 500);
  }
});

export default app;
