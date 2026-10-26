require('dotenv').config({ quiet: true });

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
};

module.exports = {
  port: Number(process.env.PORT || 3000),
  mongoUri: required('MONGODB_URI'),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  accessTtl: process.env.JWT_ACCESS_TTL || '15m',
  refreshTtl: process.env.JWT_REFRESH_TTL || '30d',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 12),
  corsOrigins: (process.env.CORS_ORIGINS || 'https://localhost').split(',').map((s) => s.trim()),
};
