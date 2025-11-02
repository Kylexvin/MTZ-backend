import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  balances: {
    MTZ: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  limits: {
    dailySendLimit: {
      type: Number,
      default: 10000
    },
    dailyReceiveLimit: {
      type: Number,
      default: 50000
    },
    dailySendUsed: {
      type: Number,
      default: 0
    },
    lastReset: {
      type: Date,
      default: Date.now
    }
  },
  stats: {
    totalReceived: { type: Number, default: 0 },
    totalSent: { type: Number, default: 0 },
    transactionCount: { type: Number, default: 0 },
    lastTransaction: Date
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  lockReason: String,
  failedAttempts: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

walletSchema.index({ 'balances.MTZ': 1 });
walletSchema.index({ 'limits.lastReset': 1 });

walletSchema.statics.resetDailyLimits = async function() {
  await this.updateMany(
    {},
    { 
      $set: { 
        'limits.dailySendUsed': 0,
        'limits.lastReset': new Date()
      }
    }
  );
};

walletSchema.statics.getOrCreateWallet = async function(userId) {
  let wallet = await this.findOne({ user: userId });
  if (!wallet) {
    wallet = await this.create({ user: userId });
  }
  return wallet;
};

walletSchema.statics.getOrCreateWalletInSession = async function(userId, session) {
  let wallet = await this.findOne({ user: userId }).session(session);
  if (!wallet) {
    const [newWallet] = await this.create([{ user: userId }], { session });
    wallet = newWallet;
  }
  return wallet;
};

walletSchema.statics.transferFeeToAdmin = async function(feeAmount, session) {
  if (feeAmount > 0) {
    const adminWallet = await this.getOrCreateWalletInSession(
      process.env.ADMIN_USER_ID,
      session
    );
    await adminWallet.addTokens(feeAmount, session);
  }
};

walletSchema.statics.transferTokensWithFees = async function(
  fromUserId, 
  toUserId, 
  amount, 
  feeAmount,
  description = '', 
  session = null
) {
  const fromWallet = await this.findOne({ user: fromUserId }).session(session);
  if (!fromWallet) {
    throw new Error('Sender wallet not found');
  }

  const toWallet = await this.getOrCreateWalletInSession(toUserId, session);

  const totalDeduction = amount + feeAmount;
  if (!fromWallet.canSend(totalDeduction)) {
    throw new Error(`Insufficient balance. Need ${totalDeduction} MTZ (including ${feeAmount} MTZ fees)`);
  }

  await fromWallet.deductTokens(totalDeduction, session);
  await toWallet.addTokens(amount, session);

  if (feeAmount > 0) {
    await this.transferFeeToAdmin(feeAmount, session);
  }

  const Transaction = mongoose.model('Transaction');
  const transactionRecord = await Transaction.createTokenTransfer({
    fromUser: fromUserId,
    toUser: toUserId,
    tokensAmount: amount,
    fees: {
      amount: feeAmount,
      rate: feeAmount / amount
    },
    notes: description
  });

  return {
    success: true,
    fromBalance: fromWallet.balances.MTZ,
    toBalance: toWallet.balances.MTZ,
    transactionId: transactionRecord._id
  };
};

walletSchema.statics.transferTokens = async function(fromUserId, toUserId, amount, description = '') {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();

    const fromWallet = await this.findOne({ user: fromUserId }).session(session);
    if (!fromWallet) {
      throw new Error('Sender wallet not found');
    }

    const toWallet = await this.getOrCreateWalletInSession(toUserId, session);

    if (!fromWallet.canSend(amount)) {
      throw new Error('Insufficient balance or transfer limits exceeded');
    }

    await fromWallet.deductTokens(amount, session);
    await toWallet.addTokens(amount, session);

    const Transaction = mongoose.model('Transaction');
    await Transaction.createTokenTransfer({
      fromUser: fromUserId,
      toUser: toUserId,
      tokensAmount: amount,
      notes: description
    });

    await session.commitTransaction();

    const updatedFromWallet = await this.findOne({ user: fromUserId });
    const updatedToWallet = await this.findOne({ user: toUserId });

    return {
      success: true,
      fromBalance: updatedFromWallet.balances.MTZ,
      toBalance: updatedToWallet.balances.MTZ
    };

  } catch (error) {
    await session.abortTransaction();
    console.error('Transfer transaction failed:', error.message);
    throw error;
  } finally {
    session.endSession();
  }
};

walletSchema.statics.bulkTransfer = async function(fromUserId, transfers, description = '') {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();

    const fromWallet = await this.findOne({ user: fromUserId }).session(session);
    if (!fromWallet) {
      throw new Error('Sender wallet not found');
    }

    const totalAmount = transfers.reduce((sum, transfer) => sum + transfer.amount, 0);
    
    if (!fromWallet.canSend(totalAmount)) {
      throw new Error('Insufficient balance for bulk transfer');
    }

    for (const transfer of transfers) {
      const toWallet = await this.getOrCreateWalletInSession(transfer.toUserId, session);
      await fromWallet.deductTokens(transfer.amount, session);
      await toWallet.addTokens(transfer.amount, session);

      await mongoose.model('Transaction').createTokenTransfer({
        fromUser: fromUserId,
        toUser: transfer.toUserId,
        tokensAmount: transfer.amount,
        notes: transfer.description || description
      });
    }

    await session.commitTransaction();

    return {
      success: true,
      totalTransferred: totalAmount,
      transferCount: transfers.length
    };

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

walletSchema.statics.simpleTransfer = async function(fromUserId, toUserId, amount) {
  const fromWallet = await this.findOne({ user: fromUserId });
  const toWallet = await this.getOrCreateWallet(toUserId);
  
  if (!fromWallet) {
    throw new Error('Sender wallet not found');
  }
  
  if (!fromWallet.canSend(amount)) {
    throw new Error('Insufficient balance or transfer limits exceeded');
  }
  
  await fromWallet.deductTokens(amount);
  await toWallet.addTokens(amount);
  
  return {
    success: true,
    fromBalance: fromWallet.balances.MTZ,
    toBalance: toWallet.balances.MTZ
  };
};

walletSchema.methods.getBalance = function() {
  return this.balances.MTZ;
};

walletSchema.methods.canSend = function(amount) {
  if (this.isLocked) return false;
  if (this.balances.MTZ < amount) return false;
  
  const today = new Date();
  const lastReset = new Date(this.limits.lastReset);
  const isSameDay = lastReset.toDateString() === today.toDateString();
  
  if (isSameDay && this.limits.dailySendUsed + amount > this.limits.dailySendLimit) {
    return false;
  }
  
  return true;
};

walletSchema.methods.addTokens = function(amount, session = null) {
  this.balances.MTZ += amount;
  this.stats.totalReceived += amount;
  this.stats.transactionCount += 1;
  this.stats.lastTransaction = new Date();
  
  if (session) {
    return this.save({ session });
  }
  return this.save();
};

walletSchema.methods.deductTokens = function(amount, session = null) {
  if (!this.canSend(amount)) {
    throw new Error('Insufficient balance, wallet locked, or daily limit exceeded');
  }
  
  this.balances.MTZ -= amount;
  this.stats.totalSent += amount;
  this.stats.transactionCount += 1;
  this.stats.lastTransaction = new Date();
  
  const today = new Date();
  const lastReset = new Date(this.limits.lastReset);
  const isSameDay = lastReset.toDateString() === today.toDateString();
  
  if (isSameDay) {
    this.limits.dailySendUsed += amount;
  } else {
    this.limits.dailySendUsed = amount;
    this.limits.lastReset = today;
  }
  
  if (session) {
    return this.save({ session });
  }
  return this.save();
};

walletSchema.methods.getSummary = async function() {
  await this.populate('user', 'name phone role');
  
  return {
    user: {
      id: this.user._id,
      name: this.user.name,
      phone: this.user.phone,
      role: this.user.role
    },
    balance: this.balances.MTZ,
    limits: this.limits,
    stats: this.stats,
    isLocked: this.isLocked
  };
};

export default mongoose.model('Wallet', walletSchema);