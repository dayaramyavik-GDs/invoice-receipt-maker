const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const mongoose = require('mongoose');
const config = require('./config');
const authRoutes = require('./routes/auth');
const syncRoutes = require('./routes/sync');
const { requireAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/error');

const app = express();
app.set('trust proxy', 1);                       // behind the Kubernetes ingress: real client IPs for rate limiting
app.use(helmet());
app.use(cors({ origin: config.corsOrigins }));
app.use(express.json({ limit: '2mb' }));          // logos travel as small data URLs

app.get('/health/live', (req, res) => res.json({ status: 'ok' }));
app.get('/health/ready', (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'database-unavailable' });
});

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/sync', requireAuth, syncRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
