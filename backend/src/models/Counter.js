const { Schema, model } = require('mongoose');

const Counter = model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }));

// Per-user, ever-increasing change number used as the pull cursor.
async function nextSeq(userId) {
  const c = await Counter.findOneAndUpdate(
    { _id: `seq:${userId}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  return c.seq;
}

module.exports = { Counter, nextSeq };
