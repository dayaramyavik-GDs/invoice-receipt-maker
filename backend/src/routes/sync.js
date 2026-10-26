const express = require('express');
const { z } = require('zod');
const SyncRecord = require('../models/SyncRecord');
const { nextSeq } = require('../models/Counter');
const { validators } = require('../validation/entities');

const router = express.Router();
const PULL_LIMIT = 200;

const changeSchema = z.object({
  opId: z.string().uuid(),
  entity: z.enum(['profile', 'customer', 'item', 'document']),
  id: z.string().min(1).max(64),
  baseVersion: z.number().int().min(0),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable().optional(),
  data: z.record(z.string(), z.unknown()),
});
const pushSchema = z.object({ changes: z.array(changeSchema).max(100) });

const toClient = (r) => ({
  entity: r.entity, id: r.recordId, data: r.data, version: r.version,
  updatedAt: r.updatedAt.toISOString(), deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
});
const conflict = (opId, record) => ({ opId, status: 'conflict', server: toClient(record) });

async function applyChange(userId, c) {
  const parsed = validators[c.entity].safeParse(c.data);
  if (!parsed.success) return { opId: c.opId, status: 'rejected', error: parsed.error.issues[0]?.message || 'Invalid data' };

  const filter = { userId, entity: c.entity, recordId: c.id };
  const fields = async (version) => ({
    data: parsed.data, version, serverSeq: await nextSeq(userId),
    updatedAt: c.updatedAt, deletedAt: c.deletedAt ?? null, lastOpId: c.opId,
  });

  const existing = await SyncRecord.findOne(filter).lean();
  if (!existing) {
    try {
      await SyncRecord.create({ ...filter, ...(await fields(1)) });
      return { opId: c.opId, status: 'applied', version: 1 };
    } catch (err) {
      if (err.code !== 11000) throw err;                  // another device created it a moment ago
      return conflict(c.opId, await SyncRecord.findOne(filter).lean());
    }
  }
  if (existing.lastOpId === c.opId) return { opId: c.opId, status: 'duplicate', version: existing.version };
  if (existing.version !== c.baseVersion) return conflict(c.opId, existing);

  const version = existing.version + 1;
  // Including the version in the filter makes this an atomic compare-and-set.
  const { modifiedCount } = await SyncRecord.updateOne(
    { _id: existing._id, version: existing.version },
    { $set: await fields(version) },
  );
  if (!modifiedCount) return conflict(c.opId, await SyncRecord.findById(existing._id).lean());
  return { opId: c.opId, status: 'applied', version };
}

router.post('/push', async (req, res) => {
  const { changes } = pushSchema.parse(req.body);
  const results = [];
  for (const change of changes) results.push(await applyChange(req.user.id, change));
  res.json({ results });
});

router.get('/pull', async (req, res) => {
  const since = z.coerce.number().int().min(0).parse(req.query.since ?? 0);
  const docs = await SyncRecord.find({ userId: req.user.id, serverSeq: { $gt: since } })
    .sort({ serverSeq: 1 }).limit(PULL_LIMIT + 1).lean();
  const page = docs.slice(0, PULL_LIMIT);
  res.json({
    records: page.map(toClient),
    nextSince: page.length ? page[page.length - 1].serverSeq : since,
    hasMore: docs.length > PULL_LIMIT,
  });
});

module.exports = router;
