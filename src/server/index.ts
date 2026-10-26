import { createServer } from 'node:http';
import { createApp } from './app';
import { hashPassword } from './auth';
import { DEMO_PASSWORD, DEMO_USERS, loadConfig } from './config';
import { Repo } from './db';
import { createMailer } from './mailer';
import { Metrics } from './metrics';
import { createRealtime } from './realtime';

async function seedDemoUsers(repo: Repo): Promise<void> {
  for (const name of DEMO_USERS) {
    if (repo.getUserByName(name)) continue;
    repo.createUser(name, await hashPassword(DEMO_PASSWORD));
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const repo = new Repo(config.dbPath);
  console.info(
    config.upstash
      ? 'Cuentas y progreso: Upstash Redis (duradero)'
      : 'Cuentas y progreso: SQLite local (con disco efimero se pierden en cada despliegue; ' +
          'define UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN)',
  );
  const metrics = new Metrics();

  const http = createServer();
  const realtime = createRealtime(http, { config, metrics, repo });
  const app = createApp({
    config,
    repo,
    metrics,
    runtime: realtime.runtime,
    mailer: createMailer(config.email),
  });
  http.on('request', app);

  http.listen(config.port, '0.0.0.0', () => {
    console.info(`CyberGrid escuchando en el puerto ${config.port} (${config.env})`);
  });

  if (config.demoAccounts) {
    seedDemoUsers(repo).catch((err) => console.error('no se pudieron crear las cuentas demo', err));
  }

  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.info(`${signal} recibido, cerrando`);
    const force = setTimeout(() => process.exit(0), 8000);
    force.unref();
    realtime
      .close()
      .catch(() => undefined)
      .finally(() => {
        http.close(() => {
          metrics.stop();
          repo.close();
          process.exit(0);
        });
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
