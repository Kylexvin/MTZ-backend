import mongoose from 'mongoose';

const kccSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'KCC branch name is required'],
    trim: true
  },
  code: {
    type: String,
    required: [true, 'KCC branch code is required'],
    unique: true,
    uppercase: true,
    trim: true
  },
  location: {
    county: {
      type: String,
      required: true
    },
    town: String
  },
  contact: {
    phone: String,
    email: String
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true
});

kccSchema.index({ 'location.county': 1 });
kccSchema.index({ status: 1 });

kccSchema.statics.findByCode = function(code) {
  return this.findOne({ code: code.toUpperCase() });
};

kccSchema.statics.findActiveBranches = function() {
  return this.find({ status: 'active' });
};

kccSchema.statics.getSystemSummary = async function() {
  const summary = await this.aggregate([
    {
      $group: {
        _id: null,
        totalBranches: { $sum: 1 },
        activeBranches: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        counties: { $addToSet: '$location.county' }
      }
    }
  ]);
  
  return summary[0] || {
    totalBranches: 0,
    activeBranches: 0,
    counties: []
  };
};

export default mongoose.model('Kcc', kccSchema); 