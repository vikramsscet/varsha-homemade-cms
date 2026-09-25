const { PORT } = require('./config/env');
const prisma = require('./config/database');
const app = require('./app');

const server = app.listen(PORT, () => {
  console.log(`Varsha Homemade CMS running on http://localhost:${PORT}`);
});

const shutdown = (signal) => {
  console.log(`${signal} received. Shutting down application.`);

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
