import { env } from './config/env.js';
import { createApp } from './app.js';
import { seed } from './db/seed.js';
import { closeDatabase } from './services/database.service.js';

await seed();

const server = createApp().listen(env.port, () => {
  console.log(`Astik Gate Pass API running at http://localhost:${env.port}/api`);
});

// Finish open requests before stopping (Ctrl+C or a host restart).
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(async () => {
    await closeDatabase(); // release database connections cleanly
    process.exit(0);
  }));
}
