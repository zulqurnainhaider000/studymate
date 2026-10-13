import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const uploadDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const { app } = await import('./app.js');
const { pool } = await import('./config/database.js');
const { runMigrations } = await import('./config/migrate.js');
const { initActivityTable } = await import('./services/activityService.js');

try {
  await runMigrations();
  await initActivityTable();
} catch (dbErr) {
  console.error('[Startup] Critical database initialization/migration error:', dbErr);
}

const port = Number(process.env.PORT ?? 4000);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`StudyMate AI API listening on port ${port}`);
});

const shutdown = async (signal: string): Promise<void> => {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
