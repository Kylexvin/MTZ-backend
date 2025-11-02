// src/models/DeliveryRequest.js
import mongoose from 'mongoose';

const deliveryRequestSchema = new mongoose.Schema({
  // Request Details
  depot: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Depot',
    required: true
  },
  depotAttendant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  litersRequested: {
    type: Number,
    required: true,
    min: 1
  },
  
  // KCC Branch Targeting
  assignedKcc: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Kcc',
    required: true
  },
  targetAttendants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  
  // QR Code Verification
  qrCode: {
    type: String,
    required: true,
    unique: true
  },
  
  // Status & Timing
  status: {
    type: String,
    enum: ['pending', 'completed', 'expired', 'cancelled'],
    default: 'pending'
  },
  expiresAt: {
    type: Date,
    required: true
  },
  completedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Delivery Details (filled upon completion)
  completedAt: Date,
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  }
}, {
  timestamps: true
});

// Indexes - REMOVED duplicate qrCode index
deliveryRequestSchema.index({ depot: 1, status: 1 });
deliveryRequestSchema.index({ assignedKcc: 1, status: 1 });
deliveryRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Static Methods
deliveryRequestSchema.statics.generateQRCode = function() {
  return `DELIVERY_${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
};

deliveryRequestSchema.statics.cleanupExpired = async function() {
  return this.updateMany(
    { 
      status: 'pending', 
      expiresAt: { $lt: new Date() } 
    },
    { status: 'expired' }
  );
};

// Find requests for specific KCC branch
deliveryRequestSchema.statics.findByKccBranch = function(kccBranchId) {
  return this.find({
    assignedKcc: kccBranchId,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).populate('depot', 'name code location');
};

export default mongoose.model('DeliveryRequest', deliveryRequestSchema);