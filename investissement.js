const mongoose = require('mongoose');

const InvestmentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['CRYPTO', 'FIXED_RATE'], required: true },
  assetName: { type: String, required: true },
  amount: { type: Number, required: true },
  dailyReturnRate: { type: Number, required: true },
  durationDays: { type: Number, required: true },
  daysCompleted: { type: Number, default: 0 },
  totalEarned: { type: Number, default: 0 },
  status: { type: String, enum: ['ACTIVE', 'COMPLETED'], default: 'ACTIVE' },
  startDate: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Investment', InvestmentSchema);
