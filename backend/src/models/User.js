const { Schema, model } = require('mongoose');

const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  tokenVersion: { type: Number, default: 0 }, // incremented to revoke every refresh token
}, { timestamps: true });

module.exports = model('User', userSchema);
