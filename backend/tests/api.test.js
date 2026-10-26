require('./env');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');

let mongod;
let token;
let refreshToken;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const res = await request(app).post('/api/v1/auth/register').send({ email: 'test@example.com', password: 'a-long-test-password' });
  ({ accessToken: token, refreshToken } = res.body);
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const change = (over = {}) => ({
  opId: randomUUID(), entity: 'customer', id: 'cust-1', baseVersion: 0,
  updatedAt: new Date().toISOString(), data: { name: 'Ada Lovelace' }, ...over,
});
const push = (changes, auth = token) =>
  request(app).post('/api/v1/sync/push').set('Authorization', `Bearer ${auth}`).send({ changes });
const pull = (since, auth = token) =>
  request(app).get(`/api/v1/sync/pull?since=${since}`).set('Authorization', `Bearer ${auth}`);

test('health endpoints respond', async () => {
  await request(app).get('/health/live').expect(200);
  await request(app).get('/health/ready').expect(200);
});

test('sync requires a token', () => request(app).get('/api/v1/sync/pull').expect(401));

test('short passwords and duplicate emails are refused', async () => {
  await request(app).post('/api/v1/auth/register').send({ email: 'x@example.com', password: 'short' }).expect(400);
  await request(app).post('/api/v1/auth/register').send({ email: 'test@example.com', password: 'a-long-test-password' }).expect(409);
});

test('wrong password is refused', () =>
  request(app).post('/api/v1/auth/login').send({ email: 'test@example.com', password: 'wrong-password' }).expect(401));

test('refresh token issues a new access token', async () => {
  const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
  assert.equal(typeof res.body.accessToken, 'string');
});

test('push applies a record, replay is idempotent, pull returns it', async () => {
  const first = change();
  const res = await push([first]).expect(200);
  assert.equal(res.body.results[0].status, 'applied');
  assert.equal(res.body.results[0].version, 1);

  const replay = await push([first]).expect(200);
  assert.equal(replay.body.results[0].status, 'duplicate');

  const all = await pull(0).expect(200);
  assert.equal(all.body.records.length, 1);
  assert.equal(all.body.records[0].id, 'cust-1');
  assert.equal(all.body.records[0].version, 1);
  assert.equal(all.body.records[0].data.name, 'Ada Lovelace');

  const none = await pull(all.body.nextSince).expect(200);
  assert.equal(none.body.records.length, 0);
});

test('a stale baseVersion is reported as a conflict, the right one is applied', async () => {
  const stale = await push([change({ data: { name: 'Edited elsewhere' } })]).expect(200);
  assert.equal(stale.body.results[0].status, 'conflict');
  assert.equal(stale.body.results[0].server.version, 1);

  const ok = await push([change({ baseVersion: 1, data: { name: 'Ada King' } })]).expect(200);
  assert.equal(ok.body.results[0].status, 'applied');
  assert.equal(ok.body.results[0].version, 2);
});

test('invalid data is rejected per change, not the whole batch', async () => {
  const res = await push([change({ id: 'cust-2', data: { name: '' } })]).expect(200);
  assert.equal(res.body.results[0].status, 'rejected');
});

test('malformed push body is a 400', () => push([{ entity: 'nope' }]).expect(400));

test('users cannot see each other records', async () => {
  const other = await request(app).post('/api/v1/auth/register').send({ email: 'other@example.com', password: 'another-long-password' });
  const res = await pull(0, other.body.accessToken).expect(200);
  assert.equal(res.body.records.length, 0);
});

test('account deletion removes the user and their data', async () => {
  const u = await request(app).post('/api/v1/auth/register').send({ email: 'leaver@example.com', password: 'leaving-long-password' });
  await push([change({ id: 'cust-9' })], u.body.accessToken).expect(200);
  await request(app).delete('/api/v1/auth/account').set('Authorization', `Bearer ${u.body.accessToken}`).expect(204);
  await request(app).post('/api/v1/auth/login').send({ email: 'leaver@example.com', password: 'leaving-long-password' }).expect(401);
});
