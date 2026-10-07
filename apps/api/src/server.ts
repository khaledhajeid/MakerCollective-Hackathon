import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';
import { createRedis } from './lib/redis.js';

const env = loadEnv();
const { pool, db } = createDb(env.DATABASE_URL, env.DATABASE_POOL_MAX);
const redis = createRedis(env.REDIS_URL);

const app = await buildApp({ env, db, redis });

if (redis) {
  redis.on('error', (err) => app.log.warn({ err: err.message }, 'redis unavailable — degrading'));
  redis.connect().catch(() => undefined);
}

app.addHook('onClose', async () => {
  await Promise.allSettled([pool.end(), redis?.quit()]);
});

// Graceful shutdown: stop accepting, finish in-flight requests, release connections.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    // Docker sends SIGKILL after 10 s. Leave on our own terms if a stray connection keeps close() waiting.
    setTimeout(() => process.exit(1), 8_000).unref();
    app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

await app.listen({ host: env.HOST, port: env.PORT });
// After listen: a TV may connect immediately, and the hub resyncs from the database as soon as it is listening.
await app.resultsHub.start();
