// Test-only values; the real database URI is replaced by an in-memory server in each test file.
process.env.MONGODB_URI = 'mongodb://placeholder/test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-not-for-production';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-not-for-production';
process.env.BCRYPT_ROUNDS = '4';
