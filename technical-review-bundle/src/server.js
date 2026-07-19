const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/prisma');

const server = app.listen(env.port, () => console.log(`smsv3 API listening on port ${env.port} (${env.nodeEnv})`));
async function shutdown() { await prisma.$disconnect(); server.close(() => process.exit(0)); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
