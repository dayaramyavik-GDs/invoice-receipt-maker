const mongoose = require('mongoose');
const app = require('./app');
const config = require('./config');

// Keep retrying instead of exiting: /health/ready returns 503 until connected, so Kubernetes
// simply holds traffic back while the database starts, rather than crash-looping the pod.
async function connectWithRetry() {
  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
      console.log('MongoDB connected');
      return;
    } catch (err) {
      console.error(`MongoDB connection attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, Math.min(attempt * 2000, 15000)));
    }
  }
}

async function start() {
  const server = app.listen(config.port, () => console.log(`API listening on port ${config.port}`));
  await connectWithRetry();

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
