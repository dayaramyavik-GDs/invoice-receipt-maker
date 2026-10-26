const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const config = require('../config');
const User = require('../models/User');
const SyncRecord = require('../models/SyncRecord');
const { Counter } = require('../models/Counter');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
const email = z.string().trim().toLowerCase().email().max(200);
const registerSchema = z.object({ email, password: z.string().min(10).max(128) });
const loginSchema = z.object({ email, password: z.string().min(1).max(128) });

function issueTokens(user) {
  const sub = user._id.toString();
  return {
    accessToken: jwt.sign({}, config.jwtAccessSecret, { subject: sub, expiresIn: config.accessTtl }),
    refreshToken: jwt.sign({ tv: user.tokenVersion }, config.jwtRefreshSecret, { subject: sub, expiresIn: config.refreshTtl }),
    user: { id: sub, email: user.email },
  };
}

router.post('/register', authLimiter, async (req, res) => {
  const { email: addr, password } = registerSchema.parse(req.body);
  if (await User.exists({ email: addr })) return res.status(409).json({ error: 'An account with this email already exists' });
  const user = await User.create({ email: addr, passwordHash: await bcrypt.hash(password, config.bcryptRounds) });
  return res.status(201).json(issueTokens(user));
});

router.post('/login', authLimiter, async (req, res) => {
  const { email: addr, password } = loginSchema.parse(req.body);
  const user = await User.findOne({ email: addr });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  return res.json(issueTokens(user));
});

router.post('/refresh', authLimiter, async (req, res) => {
  const { refreshToken } = z.object({ refreshToken: z.string().min(1) }).parse(req.body);
  let payload;
  try {
    payload = jwt.verify(refreshToken, config.jwtRefreshSecret, { algorithms: ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }
  const user = await User.findById(payload.sub);
  if (!user || user.tokenVersion !== payload.tv) return res.status(401).json({ error: 'Session expired, please sign in again' });
  return res.json(issueTokens(user));
});

router.post('/logout-all', requireAuth, async (req, res) => {
  await User.updateOne({ _id: req.user.id }, { $inc: { tokenVersion: 1 } });
  res.status(204).end();
});

// Required by Google Play for apps that let users create accounts.
router.delete('/account', requireAuth, async (req, res) => {
  await SyncRecord.deleteMany({ userId: req.user.id });
  await Counter.deleteOne({ _id: `seq:${req.user.id}` });
  await User.deleteOne({ _id: req.user.id });
  res.status(204).end();
});

module.exports = router;
