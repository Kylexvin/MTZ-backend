import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true
  },
  phone: {
    type: String, 
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  pin: {
    type: String,
    required: [true, 'PIN is required for transactions'],
    minlength: 4,
    maxlength: 6,
    select: false
  },
  role: {
    type: String,
    enum: ['farmer', 'attendant', 'admin', 'kcc_attendant', 'kcc_admin'],
    required: true
  },
  onboardingFee: {
    type: Number,
    default: 100
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'verified', 'waived', 'failed'],
    default: 'pending'
  },
  activatedAt: Date,
  mpesaCode: String,
  assignedDepot: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Depot'
  },
  assignedKcc: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Kcc'
  },
  status: {
    type: String,
    enum: ['active', 'pending', 'suspended'],
    default: 'pending'
  },
  county: String
}, {
  timestamps: true
});

userSchema.index({ role: 1 });
userSchema.index({ assignedDepot: 1 });
userSchema.index({ assignedKcc: 1 });
userSchema.index({ status: 1 });
userSchema.index({ paymentStatus: 1 });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.pre('save', async function(next) {
  if (!this.isModified('pin')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
    next();
  } catch (error) {
    next(error);
  }
});

userSchema.methods.generateAuthToken = function() {
  const payload = {
    userId: this._id,
    phone: this.phone,
    role: this.role
  };
  return jwt.sign(
    payload, 
    process.env.JWT_SECRET || 'milkbank_fallback_secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
};

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.comparePin = async function(candidatePin) {
  return await bcrypt.compare(candidatePin, this.pin);
};

userSchema.methods.isAttendant = function() {
  return this.role === 'attendant';
};

userSchema.methods.isFarmer = function() {
  return this.role === 'farmer';
};

userSchema.methods.isAdmin = function() {
  return this.role === 'admin';
};

userSchema.methods.isKccAttendant = function() {
  return this.role === 'kcc_attendant';
};

userSchema.methods.isKccAdmin = function() {
  return this.role === 'kcc_admin';
};

userSchema.methods.isActive = function() {
  return this.status === 'active';
};

userSchema.methods.isPaymentVerified = function() {
  return this.paymentStatus === 'verified';
};

userSchema.statics.findByRole = function(role) {
  return this.find({ role, status: 'active' });
};

userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email }).select('+password');
};

userSchema.statics.findByPhone = function(phone) {
  return this.findOne({ phone });
};

userSchema.statics.findAttendantsByDepot = function(depotId) {
  return this.find({ 
    role: 'attendant', 
    assignedDepot: depotId,
    status: 'active' 
  });
};

userSchema.statics.findKccAttendantsByBranch = function(kccId) {
  return this.find({ 
    role: 'kcc_attendant', 
    assignedKcc: kccId,
    status: 'active' 
  });
};

userSchema.statics.findPendingUsers = function() {
  return this.find({ 
    status: 'pending',
    paymentStatus: 'pending'
  });
};

userSchema.statics.findPaymentFailed = function() {
  return this.find({ 
    paymentStatus: 'failed' 
  });
};

userSchema.statics.createUser = async function(userData) {
  const existingUser = await this.findOne({
    $or: [
      { phone: userData.phone },
      { email: userData.email }
    ]
  });
  if (existingUser) {
    throw new Error('Phone number or email already registered');
  }
  const user = new this(userData);
  return user.save();
};

userSchema.statics.activateUser = async function(userId, mpesaCode = null) {
  const user = await this.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  user.status = 'active';
  user.paymentStatus = 'verified';
  user.activatedAt = new Date();
  if (mpesaCode) {
    user.mpesaCode = mpesaCode;
  }
  return user.save();
};

export default mongoose.model('User', userSchema);