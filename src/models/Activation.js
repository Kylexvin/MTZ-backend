// src/models/Activation.js
import mongoose from 'mongoose';

const activationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  role: {
    type: String,
    enum: ['farmer', 'attendant', 'admin'],
    required: true
  },
  
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  
  paymentMethod: {
    type: String,
    enum: ['mpesa', 'cash', 'bank', 'waived'],
    default: 'mpesa'
  },
  
  mpesaCode: {
    type: String,
    required: function() {
      return this.paymentMethod === 'mpesa';
    }
  },
  
  phone: {
    type: String,
    required: true
  },
  
  status: {
    type: String,
    enum: ['pending', 'verified', 'failed'],
    default: 'verified'
  },
  
  reference: {
    type: String,
    unique: true
  },
  
  notes: String

}, {
  timestamps: true
});

// Generate reference
activationSchema.pre('save', async function(next) {
  if (!this.reference) {
    const count = await this.constructor.countDocuments();
    this.reference = `ACT${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

export default mongoose.model('Activation', activationSchema);