import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['milk_deposit', 'cash_eposit', 'milk_withdrawal', 'kcc_pickup', 'kcc_delivery', 'token_transfer'],
    required: true
  },
  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  toUser: {
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User'
  },
  attendant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: function() {
      return this.type !== 'token_transfer';
    }
  },
  depot: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Depot',
    required: function() {
      return this.type !== 'token_transfer';
    }
  },
  kccAttendant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  litersRaw: {
    type: Number,
    min: 0
  },
  litersPasteurized: {
    type: Number,
    min: 0
  },
  tokensAmount: {
    type: Number,
    min: 0
  },
  cashAmount: {
    type: Number,
    min: 0
  },
  fees: {
    amount: {
      type: Number,
      default: 0
    },
    rate: {
      type: Number,
      default: 0
    },
    type: {
      type: String,
      enum: ['p2p_transfer', 'cash_redemption', 'withdrawal'],
      default: 'p2p_transfer'
    }
  },
  exchangeRate: Number,
  lactometerReading: Number,
  qualityGrade: {
    type: String,
    enum: ['premium', 'standard']
  },
  depositCode: {
    type: String,
    unique: true,
    sparse: true
  },
  shortCode: {
    type: String,
    unique: true,
    sparse: true
  },
  settlementBatch: String,
  relatedTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'completed'
  },
  reference: {
    type: String,
    unique: true
  },
  notes: String
}, {
  timestamps: true
});

transactionSchema.index({ type: 1, createdAt: -1 });
transactionSchema.index({ fromUser: 1, createdAt: -1 });
transactionSchema.index({ toUser: 1, createdAt: -1 });
transactionSchema.index({ attendant: 1, createdAt: -1 });
transactionSchema.index({ depot: 1, createdAt: -1 });
transactionSchema.index({ settlementBatch: 1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ 'fees.amount': 1 });

transactionSchema.pre('save', async function(next) {
  if (!this.reference) {
    const count = await this.constructor.countDocuments();
    this.reference = `TX${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

transactionSchema.methods.canReverse = function() {
  const reversibleTypes = ['milk_deposit', 'cash_redemption', 'milk_withdrawal'];
  return reversibleTypes.includes(this.type) && 
         this.status === 'completed' &&
         Date.now() - this.createdAt < 24 * 60 * 60 * 1000;
};

transactionSchema.methods.getDisplayCode = function() {
  if (this.depositCode && this.shortCode) {
    return {
      depositCode: this.depositCode,
      shortCode: this.shortCode
    };
  }
  return { reference: this.reference };
};

transactionSchema.statics.findByUser = function(userId, limit = 50) {
  return this.find({
    $or: [{ fromUser: userId }, { toUser: userId }]
  })
  .sort({ createdAt: -1 })
  .limit(limit)
  .populate('fromUser', 'name phone')
  .populate('toUser', 'name phone')
  .populate('depot', 'name code');
};

transactionSchema.statics.findByDepot = function(depotId, limit = 100) {
  return this.find({ depot: depotId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('fromUser', 'name phone')
    .populate('toUser', 'name phone')
    .populate('attendant', 'name phone');
};

transactionSchema.statics.findMilkDepositByCode = function(code) {
  return this.findOne({
    $or: [
      { depositCode: code },
      { shortCode: code },
      { reference: code }
    ],
    type: 'milk_deposit'
  }).populate('fromUser', 'name phone')
    .populate('depot', 'name code');
};

transactionSchema.statics.findBySettlementBatch = function(batchNumber) {
  return this.find({ settlementBatch: batchNumber })
    .populate('fromUser', 'name phone')
    .populate('toUser', 'name phone')
    .populate('depot', 'name code location.county');
};

transactionSchema.statics.getStats = async function(depotId = null, days = 30) {
  const matchStage = {
    createdAt: { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) },
    status: 'completed'
  };
  
  if (depotId) {
    matchStage.depot = new mongoose.Types.ObjectId(depotId);
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        totalLitersRaw: { $sum: '$litersRaw' },
        totalLitersPasteurized: { $sum: '$litersPasteurized' },
        totalTokens: { $sum: '$tokensAmount' },
        totalCash: { $sum: '$cashAmount' },
        totalFees: { $sum: '$fees.amount' }
      }
    }
  ]);
};

transactionSchema.statics.createMilkDeposit = async function(depositData) {
  const {
    farmerId,
    attendantId,
    depotId,
    liters,
    lactometerReading,
    exchangeRate,
    tokensAmount,
    depositCode,
    shortCode
  } = depositData;

  const transaction = new this({
    type: 'milk_deposit',
    fromUser: farmerId,
    toUser: farmerId,
    attendant: attendantId,
    depot: depotId,
    litersRaw: liters,
    tokensAmount: tokensAmount,
    exchangeRate: exchangeRate,
    lactometerReading: lactometerReading,
    qualityGrade: lactometerReading >= 28 ? 'premium' : 'standard',
    depositCode: depositCode,
    shortCode: shortCode,
    status: 'completed'
  });

  return transaction.save();
};

transactionSchema.statics.createTokenTransfer = async function(transferData) {
  const {
    fromUserId,
    toUserId,
    tokensAmount,
    fees = {},
    notes
  } = transferData;

  const transaction = new this({
    type: 'token_transfer',
    fromUser: fromUserId,
    toUser: toUserId,
    tokensAmount: tokensAmount,
    fees: fees,
    status: 'completed',
    notes: notes
  });

  return transaction.save();
};

transactionSchema.statics.createKccPickup = async function(pickupData) {
  const {
    depotId,
    attendantId,
    kccAttendantId,
    litersRaw,
    tokensReplenished,
    settlementBatch
  } = pickupData;

  const transaction = new this({
    type: 'kcc_pickup',
    fromUser: attendantId,
    toUser: kccAttendantId,
    attendant: attendantId,
    kccAttendant: kccAttendantId,
    depot: depotId,
    litersRaw: litersRaw,
    tokensAmount: tokensReplenished,
    settlementBatch: settlementBatch,
    status: 'completed'
  });

  return transaction.save();
};

export default mongoose.model('Transaction', transactionSchema);