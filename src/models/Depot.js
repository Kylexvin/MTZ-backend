import mongoose from 'mongoose';

const depotSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Depot name is required'],
    trim: true
  },
  code: {
    type: String,
    required: [true, 'Depot code is required'],
    unique: true,
    uppercase: true
  },
  location: {
    county: {
      type: String,
      required: true
    },
    subcounty: String,
    village: String
  },
  stock: {
    rawMilk: {
      type: Number,
      default: 0,
      min: 0
    },
    pasteurizedMilk: {
      type: Number, 
      default: 0,
      min: 0
    },
    capacity: {
      type: Number,
      required: true
    }
  },
  
  // ✅ NEW: Pickup Signal System
  pickupSignal: {
    estimatedLiters: {
      type: Number,
      min: 1,
      default: null
    },
    signaledAt: {
      type: Date,
      default: null
    },
    acceptedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    status: {
      type: String,
      enum: ['available', 'accepted', 'completed', 'cancelled', 'expired', null],
      default: null
    },
    expiresAt: {
      type: Date,
      default: null
    }
  },
  
  pricing: {
    baseRate: {
      type: Number,
      required: true,
      default: 1.0
    },
    premiumRate: {
      type: Number,
      required: true, 
      default: 1.2
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'seasonal_closure'],
    default: 'active'
  },
  closureReason: String,
  assignedAttendant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    default: null
  },
  pickupRules: {
    triggerType: {
      type: String,
      enum: ['capacity_percent', 'fixed_volume', 'daily_schedule', 'manual'],
      default: 'capacity_percent'
    },
    triggerValue: {
      type: Number,
      default: 80
    },
    scheduleDays: [String],
    minPickupVolume: {
      type: Number,
      default: 200
    }
  },
  performance: {
    daily: {
      deposits: { type: Number, default: 0 },
      withdrawals: { type: Number, default: 0 },
      tokenVolume: { type: Number, default: 0 }
    },
    weekly: {
      avgDailyVolume: { type: Number, default: 0 },
      pickupEfficiency: { type: Number, default: 0 },
      stockTurnover: { type: Number, default: 0 }
    },
    monthly: {
      totalVolume: { type: Number, default: 0 },
      farmerSatisfaction: { type: Number, default: 5 },
      incidentReports: { type: Number, default: 0 }
    },
    lastPerformanceReview: Date
  },
  settlement: {
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'bi-weekly', 'monthly'],
      default: 'weekly'
    },
    autoSettle: {
      type: Boolean,
      default: true
    },
    minSettlementAmount: {
      type: Number,
      default: 1000
    }
  }
}, {
  timestamps: true
});

// Indexes
depotSchema.index({ 'location.county': 1 });
depotSchema.index({ status: 1 });
depotSchema.index({ assignedAttendant: 1 });
depotSchema.index({ 'pickupSignal.status': 1 }); // ✅ NEW: For quick pickup signal queries
depotSchema.index({ 'pickupSignal.expiresAt': 1 }); // ✅ NEW: For expiry cleanup

// ✅ NEW: Method to create pickup signal
depotSchema.methods.createPickupSignal = function(estimatedLiters) {
  this.pickupSignal = {
    estimatedLiters: estimatedLiters || this.stock.rawMilk,
    signaledAt: new Date(),
    status: 'available',
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours
  };
  return this.save();
};

// ✅ NEW: Method to cancel pickup signal
depotSchema.methods.cancelPickupSignal = function() {
  if (this.pickupSignal && this.pickupSignal.status === 'available') {
    this.pickupSignal.status = 'cancelled';
    return this.save();
  }
  return Promise.resolve(this);
};

// ✅ NEW: Method to accept pickup signal (for KCC attendant)
depotSchema.methods.acceptPickupSignal = function(kccAttendantId) {
  if (this.pickupSignal && this.pickupSignal.status === 'available') {
    this.pickupSignal.status = 'accepted';
    this.pickupSignal.acceptedBy = kccAttendantId;
    return this.save();
  }
  throw new Error('Pickup signal not available or already taken');
};

// ✅ NEW: Method to complete pickup signal
depotSchema.methods.completePickupSignal = function() {
  if (this.pickupSignal && this.pickupSignal.status === 'accepted') {
    this.pickupSignal.status = 'completed';
    return this.save();
  }
  throw new Error('No accepted pickup signal to complete');
};

// ✅ NEW: Method to check if pickup signal is expired
depotSchema.methods.isPickupSignalExpired = function() {
  if (!this.pickupSignal || !this.pickupSignal.expiresAt) return false;
  return new Date() > this.pickupSignal.expiresAt;
};

// ✅ NEW: Method to auto-expire pickup signal if needed
depotSchema.methods.checkAndExpirePickupSignal = async function() {
  if (this.pickupSignal && this.isPickupSignalExpired() && this.pickupSignal.status === 'available') {
    this.pickupSignal.status = 'expired';
    await this.save();
  }
  return this.pickupSignal;
};

// ✅ NEW: Method to get pickup signal status with auto-expiry check
depotSchema.methods.getPickupSignalStatus = async function() {
  await this.checkAndExpirePickupSignal();
  return this.pickupSignal;
};

// ✅ NEW: Method to clear pickup signal (after pickup is recorded via existing flow)
depotSchema.methods.clearPickupSignal = function() {
  this.pickupSignal = {
    estimatedLiters: null,
    signaledAt: null,
    acceptedBy: null,
    status: null,
    expiresAt: null
  };
  return this.save();
};

// ✅ NEW: Static method to find depots with available pickup signals by county (MVP: County-based)
depotSchema.statics.findAvailablePickupsByCounty = function(county) {
  return this.find({
    'location.county': county,
    'pickupSignal.status': 'available',
    'pickupSignal.expiresAt': { $gt: new Date() },
    status: 'active'
  }).populate('assignedAttendant', 'name phone');
};

// ✅ NEW: Static method to find accepted pickup by KCC attendant
depotSchema.statics.findAcceptedPickupByKccAttendant = function(kccAttendantId) {
  return this.findOne({
    'pickupSignal.status': 'accepted',
    'pickupSignal.acceptedBy': kccAttendantId
  });
};

// ✅ NEW: Static method to cleanup expired pickup signals (run as cron job)
depotSchema.statics.cleanupExpiredPickupSignals = async function() {
  const result = await this.updateMany(
    {
      'pickupSignal.status': 'available',
      'pickupSignal.expiresAt': { $lt: new Date() }
    },
    {
      $set: { 'pickupSignal.status': 'expired' }
    }
  );
  return result.modifiedCount;
};

// ✅ NEW: Method to validate if depot can create pickup signal
depotSchema.methods.canCreatePickupSignal = function() {
  if (this.status !== 'active') return { canCreate: false, reason: 'Depot is not active' };
  if (this.stock.rawMilk < 1) return { canCreate: false, reason: 'No raw milk available' };
  if (this.pickupSignal && this.pickupSignal.status === 'available') {
    return { canCreate: false, reason: 'Pickup already signaled' };
  }
  return { canCreate: true };
};

// Existing methods (unchanged)
depotSchema.methods.canAcceptDeposit = function(liters) {
  if (this.status !== 'active') return false;
  if (this.stock.rawMilk + liters > this.stock.capacity) return false;
  return true;
};

depotSchema.methods.canProcessWithdrawal = function(liters) {
  if (this.status !== 'active') return false;
  if (this.stock.pasteurizedMilk < liters) return false;
  return true;
};

depotSchema.methods.addMilkStock = function(liters, milkType = 'raw') {
  if (milkType === 'raw') {
    this.stock.rawMilk += liters;
  } else {
    this.stock.pasteurizedMilk += liters;
  }
  return this.save();
};

depotSchema.methods.removeMilkStock = async function(liters, milkType = 'pasteurized') {
  if (milkType === 'raw') {
    if (this.stock.rawMilk < liters) {
      return { success: false, error: 'Insufficient raw milk stock' };
    }
    this.stock.rawMilk -= liters;
  } else {
    if (this.stock.pasteurizedMilk < liters) {
      return { success: false, error: 'Insufficient pasteurized milk stock' };
    }
    this.stock.pasteurizedMilk -= liters;
  }
  
  await this.save();
  return { success: true };
};

depotSchema.methods.needsKccPickup = function() {
  const rules = this.pickupRules;
  
  switch(rules.triggerType) {
    case 'capacity_percent':
      return this.stock.rawMilk >= (this.stock.capacity * rules.triggerValue / 100);
    
    case 'fixed_volume':
      return this.stock.rawMilk >= rules.triggerValue;
    
    case 'daily_schedule':
      const today = new Date().toLowerCase().substring(0, 3);
      return rules.scheduleDays.includes(today) && this.stock.rawMilk >= rules.minPickupVolume;
    
    case 'manual':
      return false;
  }
};

depotSchema.methods.updatePerformance = function(transaction) {
  this.performance.daily.deposits += transaction.litersDeposited || 0;
  this.performance.daily.withdrawals += transaction.litersWithdrawn || 0;
  this.performance.daily.tokenVolume += transaction.tokensAmount || 0;
  return this.save();
};

depotSchema.methods.acceptKccDelivery = function(liters) {
  return this.addMilkStock(liters, 'pasteurized');
};

depotSchema.statics.findByCounty = function(county) {
  return this.find({ 'location.county': county, status: 'active' });
};

depotSchema.statics.findByStatus = function(status) {
  return this.find({ status }).populate('assignedAttendant', 'name phone');
};

depotSchema.statics.getDepotStats = async function() {
  return this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalRawMilk: { $sum: '$stock.rawMilk' },
        totalPasteurizedMilk: { $sum: '$stock.pasteurizedMilk' },
        avgStockLevel: { $avg: { $add: ['$stock.rawMilk', '$stock.pasteurizedMilk'] } }
      }
    }
  ]);
};

depotSchema.statics.resetDailyPerformance = async function() {
  return this.updateMany(
    {},
    { 
      $set: { 
        'performance.daily.deposits': 0,
        'performance.daily.withdrawals': 0, 
        'performance.daily.tokenVolume': 0
      }
    }
  );
};

export default mongoose.model('Depot', depotSchema);