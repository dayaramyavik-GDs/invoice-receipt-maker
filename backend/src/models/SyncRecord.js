const { Schema, model } = require('mongoose');

const syncRecordSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  entity: { type: String, enum: ['profile', 'customer', 'item', 'document'], required: true },
  recordId: { type: String, required: true },      // UUID created on the phone
  data: { type: Schema.Types.Mixed, required: true },
  version: { type: Number, required: true },       // bumped on every accepted write
  serverSeq: { type: Number, required: true },
  updatedAt: { type: Date, required: true },       // client edit time (last-write-wins)
  deletedAt: { type: Date, default: null },        // tombstone
  lastOpId: String,                                // idempotency for retried pushes
}, { timestamps: { createdAt: true, updatedAt: 'serverUpdatedAt' } });

syncRecordSchema.index({ userId: 1, entity: 1, recordId: 1 }, { unique: true });
syncRecordSchema.index({ userId: 1, serverSeq: 1 });

module.exports = model('SyncRecord', syncRecordSchema);
