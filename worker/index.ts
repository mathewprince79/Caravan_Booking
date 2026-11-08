import { Hono } from 'hono';
import type { AppBindings, Env } from './env';
import { authRoutes } from './routes/auth';
import { memberRoutes } from './routes/member';
import { adminRoutes } from './routes/admin';
import { runReminderSweep } from './lib/cron';

const app = new Hono<AppBindings>();

app.get('/api/health', (c) => c.json({ ok: true }));

app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api', memberRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  console.error('[api:error]', error);
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Something went wrong. Please try again.' }, 500);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runReminderSweep(env));
  },
} satisfies ExportedHandler<Env>;
