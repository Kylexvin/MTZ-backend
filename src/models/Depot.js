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

depotSchema.index({ 'location.county': 1 });
depotSchema.index({ status: 1 });
depotSchema.index({ assignedAttendant: 1 });

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