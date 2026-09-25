const prisma = require('../config/database');

const getHealth = async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.json({
      status: 'ok',
      service: 'varsha-homemade-cms',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database health check failed:', error.message);

    res.status(503).json({
      status: 'error',
      service: 'varsha-homemade-cms',
      database: 'disconnected',
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = { getHealth };
