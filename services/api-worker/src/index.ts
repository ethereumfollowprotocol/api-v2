import { ApiException, fromHono } from 'chanfana';
import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { cors } from 'hono/cors';
import { dbCleanupMiddleware } from './middleware/db.js';
import { phaseMiddleware } from './middleware/phase.js';
import { cacheMiddleware } from './middleware/cache.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { spikeGateMiddleware } from './middleware/spike-auth.js';
import { usersRouter } from './endpoints/users/router.js';
import { HealthCheck } from './endpoints/health.js';
import { HyperdriveSpike } from './endpoints/spike.js';
import { handleApiInfo } from './endpoints/meta/api-info.js';
import { handleRootRedirect } from './endpoints/meta/root-redirect.js';
import type { AppBindings, AppVariables } from './types.js';

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

app.use('*', cors({ origin: '*', allowMethods: ['GET', 'HEAD', 'OPTIONS', 'POST'] }));
app.use('*', rateLimitMiddleware);
// Outermost so disconnect runs even when phaseMiddleware short-circuits after ensureDb().
app.use('*', dbCleanupMiddleware);
app.use('*', cacheMiddleware);
app.use('*', phaseMiddleware);

app.onError((err, c) => {
  if (err instanceof ApiException) {
    return c.json({ success: false, errors: err.buildResponse() }, err.status as ContentfulStatusCode);
  }
  console.error(JSON.stringify({ message: 'unhandled error', error: String(err), path: c.req.path }));
  return c.json({ error: 'Internal Server Error', message: 'An unexpected error occurred' }, 500);
});

const openapi = fromHono(app, {
  docs_url: '/docs',
  openapi_url: '/openapi.json',
  schema: {
    info: {
      title: 'EFP Public API',
      version: 'v1',
      description: 'Ethereum Follow Protocol API on Cloudflare Workers + Hyperdrive',
    },
  },
});

openapi.get('/api/v1/health', HealthCheck);
openapi.get('/health', HealthCheck);
// Opt-in via SPIKE_ENDPOINT_ENABLED; gate returns 404 when disabled.
app.use('/api/v1/spike/*', spikeGateMiddleware);
openapi.get('/api/v1/spike/hyperdrive', HyperdriveSpike);
openapi.route('/api/v1/users', usersRouter);

app.get('/api/v1', handleApiInfo);
app.get('/', handleRootRedirect);

export default app;
