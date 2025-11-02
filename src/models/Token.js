// src/models/Token.js
import mongoose from 'mongoose';

const tokenSchema = new mongoose.Schema({
  // Token Identity
  symbol: {
    type: String,
    default: 'MTZ',
    immutable: true
  },
  name: {
    type: String,
    default: 'Milk Token',
    immutable: true
  },

  // Token Economics
  totalSupply: {
    type: Number,
    default: 0,
    min: 0
  },
  circulatingSupply: {
    type: Number,
    default: 0,
    min: 0
  },
  burnedSupply: {
    type: Number,
    default: 0,
    min: 0
  },

  // Universal Price Configuration
  universalPrice: {
    value: {
      type: Number,
      required: true,
      default: 50 // 1 MTZ = 50 KSH
    },
    currency: {
      type: String,
      default: 'KES',
      immutable: true
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    },
    nextReview: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
    }
  },

  // ✅ UPDATED: Token Minting Rules - Simple 1:1 ratio
  mintingRules: {
    milkBacked: {
      type: Boolean,
      default: true
    },
    ratio: {
      type: Number,
      default: 1 // 1 Liter milk = 1 MTZ token
    },
    qualityMultipliers: {
      standard: {
        type: Number,
        default: 1.0
      },
      premium: {
        type: Number,
        default: 1.0 // ✅ CHANGED: No premium bonus - all milk equal
      }
    }
  },

  // Redemption Rules
  redemptionRules: {
    cashRedemptionFee: {
      type: Number,
      default: 0.02 // 2%
    },
    minRedemption: {
      type: Number,
      default: 10 // Minimum 10 MTZ for cash redemption
    },
    mpesaIntegration: {
      enabled: {
        type: Boolean,
        default: true
      },
      processingTime: {
        type: String,
        default: 'instant'
      }
    }
  },

  // Transaction Fee Structure
  feeStructure: {
    p2pTransfer: {
      rate: {
        type: Number,
        default: 0.01 // 1%
      },
      maxFee: {
        type: Number,
        default: 10 // Max 10 KSH per transaction
      },
      split: {
        mtz: {
          type: Number,
          default: 0.7 // 70% to MTZ
        },
        depot: {
          type: Number,
          default: 0.3 // 30% to depot
        }
      }
    },
    withdrawalService: {
      rate: {
        type: Number,
        default: 2 // 2 KSH per liter
      },
      recipient: {
        type: String,
        enum: ['depot', 'mtz', 'split'],
        default: 'depot'
      }
    }
  },

  // Supply Control
  supplyControl: {
    maxSupply: {
      type: Number,
      default: 10000000 // 10 million MTZ maximum
    },
    monthlyMintLimit: {
      type: Number,
      default: 500000 // 500,000 MTZ per month max
    },
    burnMechanism: {
      enabled: {
        type: Boolean,
        default: true
      },
      burnOnRedemption: {
        type: Boolean,
        default: true
      }
    }
  },

  // Status & Governance
  status: {
    type: String,
    enum: ['active', 'paused', 'maintenance'],
    default: 'active'
  },
  governance: {
    priceAdjustmentThreshold: {
      type: Number,
      default: 0.1 // 10% market deviation triggers review
    },
    adjustmentCooldown: {
      type: Number,
      default: 30 // Days between price adjustments
    }
  },

  // Audit Trail
  lastMint: Date,
  lastBurn: Date,
  lastPriceAdjustment: Date

}, {
  timestamps: true
});

// Indexes
tokenSchema.index({ symbol: 1 });
tokenSchema.index({ 'universalPrice.value': 1 });
tokenSchema.index({ status: 1 });

// Static Methods
tokenSchema.statics.getToken = async function() {
  let token = await this.findOne({ symbol: 'MTZ' });
  if (!token) {
    token = await this.create({});
  }
  return token;
};

tokenSchema.statics.mintTokens = async function(amount, reason = 'milk_deposit') {
  const token = await this.getToken();
  
  // Check minting limits
  if (token.totalSupply + amount > token.supplyControl.maxSupply) {
    throw new Error('Minting would exceed maximum supply');
  }

  // Update supplies
  token.totalSupply += amount;
  token.circulatingSupply += amount;
  token.lastMint = new Date();

  await token.save();
  
  // Log minting activity
  await TokenActivity.create({
    type: 'mint',
    amount: amount,
    reason: reason,
    totalSupply: token.totalSupply,
    circulatingSupply: token.circulatingSupply
  });

  return token;
};

tokenSchema.statics.burnTokens = async function(amount, reason = 'cash_redemption') {
  const token = await this.getToken();
  
  if (token.circulatingSupply < amount) {
    throw new Error('Insufficient circulating supply to burn');
  }

  // Update supplies
  token.circulatingSupply -= amount;
  token.burnedSupply += amount;
  token.lastBurn = new Date();

  await token.save();
  
  // Log burning activity
  await TokenActivity.create({
    type: 'burn',
    amount: amount,
    reason: reason,
    totalSupply: token.totalSupply,
    circulatingSupply: token.circulatingSupply
  });

  return token;
};

// ✅ UPDATED: Simple 1:1 calculation - no quality premium
tokenSchema.statics.calculateMintAmount = function(liters, quality = 'standard') {
  // Simple 1L milk = 1 MTZ token, regardless of quality
  return liters * this.mintingRules.ratio;
};

tokenSchema.statics.calculateRedemptionValue = function(tokenAmount) {
  const token = this;
  const fee = tokenAmount * token.redemptionRules.cashRedemptionFee;
  const netAmount = tokenAmount - fee;
  return {
    grossValue: tokenAmount * token.universalPrice.value,
    fee: fee * token.universalPrice.value,
    netValue: netAmount * token.universalPrice.value,
    tokenAmount: tokenAmount,
    netTokenAmount: netAmount
  };
};

tokenSchema.statics.updateUniversalPrice = async function(newPrice, reason = 'market_adjustment') {
  const token = await this.getToken();
  
  // Check cooldown period
  const daysSinceLastAdjustment = (new Date() - token.lastPriceAdjustment) / (1000 * 60 * 60 * 24);
  if (daysSinceLastAdjustment < token.governance.adjustmentCooldown) {
    throw new Error(`Price adjustment cooldown active. Next adjustment in ${Math.ceil(token.governance.adjustmentCooldown - daysSinceLastAdjustment)} days`);
  }

  const oldPrice = token.universalPrice.value;
  token.universalPrice.value = newPrice;
  token.universalPrice.lastUpdated = new Date();
  token.universalPrice.nextReview = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  token.lastPriceAdjustment = new Date();

  await token.save();
  
  // Log price change
  await TokenActivity.create({
    type: 'price_adjustment',
    amount: newPrice - oldPrice,
    reason: reason,
    details: {
      oldPrice: oldPrice,
      newPrice: newPrice,
      changePercent: ((newPrice - oldPrice) / oldPrice * 100).toFixed(2)
    }
  });

  return token;
};

// Instance Methods
tokenSchema.methods.getTokenMetrics = function() {
  return {
    symbol: this.symbol,
    name: this.name,
    supplies: {
      total: this.totalSupply,
      circulating: this.circulatingSupply,
      burned: this.burnedSupply,
      max: this.supplyControl.maxSupply
    },
    economics: {
      universalPrice: this.universalPrice.value,
      currency: this.universalPrice.currency,
      marketCap: this.circulatingSupply * this.universalPrice.value
    },
    rules: {
      mintingRatio: this.mintingRules.ratio,
      redemptionFee: this.redemptionRules.cashRedemptionFee,
      p2pFee: this.feeStructure.p2pTransfer.rate
    }
  };
};

tokenSchema.methods.canMint = function(amount) {
  return this.status === 'active' && 
         this.totalSupply + amount <= this.supplyControl.maxSupply;
};

export default mongoose.model('Token', tokenSchema);

// Token Activity Log Model
const tokenActivitySchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['mint', 'burn', 'price_adjustment', 'supply_update'],
    required: true
  },
  amount: Number,
  reason: String,
  totalSupply: Number,
  circulatingSupply: Number,
  details: mongoose.Schema.Types.Mixed,
  initiatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

export const TokenActivity = mongoose.model('TokenActivity', tokenActivitySchema);