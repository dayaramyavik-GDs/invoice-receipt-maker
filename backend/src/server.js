const mongoose = require('mongoose');
const app = require('./app');
const config = require('./config');

async function start() {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  console.log('MongoDB connected');
  const server = app.listen(config.port, () => console.log(`API listening on port ${config.port}`));

  // Kubernetes sends SIGTERM before stopping a pod: finish in-flight requests, then exit.
  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('Failed to start', err);
  process.exit(1);
});
