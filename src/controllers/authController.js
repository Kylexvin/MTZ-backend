// src/controllers/authController.js
import mongoose from 'mongoose';
import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import Transaction from '../models/Transaction.js';
import Activation from '../models/Activation.js';
import Wallet from '../models/Wallet.js';
import Kcc from '../models/Kcc.js';

class AuthController { 
/**
 * Register new user with payment-based activation and auto-wallet creation
 */


static async register(req, res) {
  try {
    const { name, phone, email, password, pin, role, county, mpesaCode } = req.body;
    
    // Onboarding fee structure
    const onboardingFees = {
      farmer: 100,
      attendant: 500,
      admin: 1000
    };

    let status = 'pending';
    let message = 'Registration submitted - Complete payment to activate account';
    let onboardingFee = onboardingFees[role] || 100;

    // Super admin exception
    if (email === 'superadmin@milkbank.com' && role === 'admin') {
      status = 'active';
      onboardingFee = 0;
      message = 'Super Admin created successfully!';
    }

    // ✅ SIMPLIFIED: Create user without transaction
    const newUser = await User.create({ 
      name, phone, email, password, pin, role, status, county,
      onboardingFee: onboardingFee,
      paymentStatus: onboardingFee > 0 ? 'pending' : 'waived'
    });

    // ✅ SIMPLIFIED: Auto-create wallet without transaction
    await Wallet.create({ user: newUser._id });

    // If M-Pesa code provided, verify immediately
    if (mpesaCode && onboardingFee > 0) {
      const paymentVerified = await AuthController.verifyMpesaPayment(mpesaCode, onboardingFee, phone);
      if (paymentVerified) {
        newUser.status = 'active';
        newUser.paymentStatus = 'verified';
        newUser.activatedAt = new Date();
        await newUser.save();
        message = 'Registration successful! Account activated.';
      }
    }

    // Generate token
    const token = newUser.generateAuthToken();
    
    // Get wallet balance for response
    const wallet = await Wallet.getOrCreateWallet(newUser._id);
    
    // Response
    const userResponse = {
      id: newUser._id,
      name: newUser.name,
      phone: newUser.phone,
      email: newUser.email,
      role: newUser.role,
      status: newUser.status,
      county: newUser.county,
      onboardingFee: newUser.onboardingFee,
      paymentStatus: newUser.paymentStatus
    };

    res.status(201).json({
      success: true,
      message,
      data: { 
        user: userResponse, 
        token,
        wallet: {
          balance: wallet.getBalance()
        },
        paymentRequired: onboardingFee > 0 && newUser.status === 'pending',
        onboardingFee: onboardingFee
      }
    });
    
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({
        success: false,
        message: `${field === 'phone' ? 'Phone number' : 'Email'} already registered`
      });
    }
    
    res.status(400).json({
      success: false,
      message: error.message
    });
  }
}
/**
 * Register KCC admin (System Admin only)
 */
static async registerKccAdmin(req, res) {
  try {
    const { name, phone, email, password, pin, kccBranchId, county } = req.body;
    
    // Verify requester is system admin
    const admin = await User.findById(req.user.id);
    if (!admin.isAdmin()) {
      return res.status(403).json({
        success: false,
        message: 'Only system admins can register KCC admins'
      });
    }
    
    // Verify KCC branch exists
    const kccBranch = await Kcc.findById(kccBranchId);
    if (!kccBranch) {
      return res.status(404).json({
        success: false,
        message: 'KCC branch not found'
      });
    }
    
    // Create KCC admin user
    const kccAdmin = await User.createUser({
      name,
      phone,
      email,
      password,
      pin,
      role: 'kcc_admin',
      assignedKcc: kccBranchId,
      county,
      status: 'active',
      paymentStatus: 'verified'
    });
    
    // Create wallet
    await Wallet.getOrCreateWallet(kccAdmin._id);
    
    res.status(201).json({
      success: true,
      message: `KCC admin ${name} registered successfully`,
      data: {
        user: {
          id: kccAdmin._id,
          name: kccAdmin.name,
          phone: kccAdmin.phone,
          email: kccAdmin.email,
          role: kccAdmin.role,
          assignedKcc: kccAdmin.assignedKcc
        }
      }
    });
    
  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'KCC admin registration failed',
      error: error.message
    });
  }
}
/**
 * User login 
 */
static async login(req, res) {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }
    
    // Return user data even if pending, but with different status
    const userResponse = {
      id: user._id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      status: user.status,
      tokenBalance: user.tokenBalance,
      county: user.county,
      assignedDepot: user.assignedDepot,
      onboardingFee: user.onboardingFee,
      paymentStatus: user.paymentStatus
    };
    
    if (user.status !== 'active') {
      return res.status(200).json({  // Return 200 but indicate pending status
        success: true,
        message: user.paymentStatus === 'pending' 
          ? 'Account pending payment verification' 
          : 'Account suspended',
        data: { 
          user: userResponse, 
          token: null, // No token for pending users
          requiresPayment: user.paymentStatus === 'pending'
        }
      });
    }
    
    const token = user.generateAuthToken();
    
    res.json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      data: { user: userResponse, token }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
}

/**
 * User login with phone number
 */
static async loginWithPhone(req, res) {
  try {
    const { phone, password } = req.body;
    
    // Format phone number to ensure consistency
    const formattedPhone = phone.startsWith('254') ? phone : `254${phone.replace(/^0/, '')}`;
    
    const user = await User.findOne({ phone: formattedPhone }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password'
      });
    }
    
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid phone number or password'
      });
    }
    
    // Return user data even if pending, but with different status
    const userResponse = {
      id: user._id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      status: user.status,
      tokenBalance: user.tokenBalance,
      county: user.county,
      assignedDepot: user.assignedDepot,
      onboardingFee: user.onboardingFee,
      paymentStatus: user.paymentStatus
    };
    
    if (user.status !== 'active') {
      return res.status(200).json({  // Return 200 but indicate pending status
        success: true,
        message: user.paymentStatus === 'pending' 
          ? 'Account pending payment verification' 
          : 'Account suspended',
        data: { 
          user: userResponse, 
          token: null, // No token for pending users
          requiresPayment: user.paymentStatus === 'pending'
        }
      });
    }
    
    const token = user.generateAuthToken();
    
    res.json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      data: { user: userResponse, token }
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: error.message
    });
  }
}
  /**
   * Verify PIN
   */
  static async verifyPin(req, res) {
    try {
      const { pin } = req.body;
      
      const user = await User.findById(req.user.id).select('+pin');
      
      const isPinValid = await user.comparePin(pin);
      if (!isPinValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid PIN'
        });
      }
      
      res.json({
        success: true,
        message: 'PIN verified successfully',
        data: { verified: true }
      });
      
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'PIN verification failed',
        error: error.message
      });
    }
  }

/**
 * Verify payment WITHOUT requiring JWT token
 * Users can verify with phone + M-Pesa code
 */
static async verifyPaymentPublic(req, res) {
  try {
    const { phone, mpesaCode } = req.body;

    // Find user by phone (no token required)
    const user = await User.findOne({ phone });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please check your phone number.'
      });
    }

    if (user.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Account already active'
      });
    }

    // Verify payment
    const paymentVerified = await AuthController.verifyMpesaPayment(mpesaCode, user.onboardingFee, user.phone);
    
    if (!paymentVerified) {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed. Please check your M-Pesa code.'
      });
    }

    // Activate user
    user.status = 'active';
    user.paymentStatus = 'verified';
    user.activatedAt = new Date();
    await user.save();

    // Create payment transaction
    const activation = new Activation({
      user: user._id,
      role: user.role,
      amount: user.onboardingFee,
      paymentMethod: 'mpesa',
      mpesaCode: mpesaCode,
      phone: user.phone,
      status: 'verified',
      notes: `Account activation for ${user.name}`
    });
    await activation.save();

    // Generate new token for immediate login
    const token = user.generateAuthToken();

    res.json({
      success: true,
      message: 'Payment verified! Account activated.',
      data: {
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          status: user.status
        },
        token // ✅ Provide new token
      }
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Payment verification failed',
      error: error.message
    });
  }
}

/**
 * Get payment instructions WITHOUT requiring JWT token
 */
static async getPaymentInstructionsPublic(req, res) {
  try {
    const { phone } = req.body;

    const user = await User.findOne({ phone });
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found. Please check your phone number.'
      });
    }

    if (user.status === 'active') {
      return res.json({
        success: true,
        message: 'Account already active',
        data: { paymentRequired: false }
      });
    }

    const instructions = {
      paymentRequired: true,
      amount: user.onboardingFee,
      paybill: "247247",
      accountNumber: user.phone,
      instructions: `Send KSH ${user.onboardingFee} to Paybill 247247, Account: ${user.phone}`
    };

    res.json({
      success: true,
      message: 'Payment instructions',
      data: instructions
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get payment instructions',
      error: error.message
    });
  }
}
  /**
   * Get user profile
   */
  static async getProfile(req, res) {
    try {
      const user = await User.findById(req.user.id)
        .populate('assignedDepot', 'name code location');
      
      const profile = {
        id: user._id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        role: user.role,
        status: user.status,
        county: user.county,
        tokenBalance: user.tokenBalance,
        assignedDepot: user.assignedDepot,
        onboardingFee: user.onboardingFee,
        paymentStatus: user.paymentStatus,
        activatedAt: user.activatedAt
      };

      res.json({
        success: true,
        message: 'Profile retrieved',
        data: { user: profile }
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to load profile',
        error: error.message
      });
    }
  }

  /**
   * Update profile
   */
  static async updateProfile(req, res) {
    try {
      const { name, county } = req.body;
      
      const user = await User.findByIdAndUpdate(
        req.user.id,
        { name, county },
        { new: true, runValidators: true }
      ).populate('assignedDepot', 'name code location');

      res.json({
        success: true,
        message: 'Profile updated',
        data: { user }
      });
      
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Profile update failed',
        error: error.message
      });
    }
  }
// ADD THESE MISSING METHODS TO YOUR AuthController:

/**
 * Verify payment WITH JWT token (original method)
 */
static async verifyPayment(req, res) {
  try {
    const { mpesaCode } = req.body;
    const userId = req.user.id;

    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.status === 'active') {
      return res.status(400).json({
        success: false,
        message: 'Account already active'
      });
    }

    const paymentVerified = await AuthController.verifyMpesaPayment(mpesaCode, user.onboardingFee, user.phone);
    
    if (!paymentVerified) {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }

    user.status = 'active';
    user.paymentStatus = 'verified';
    user.activatedAt = new Date();
    await user.save();

    // Create payment transaction
    const activation = new Activation({
      user: userId,
      role: user.role,
      amount: user.onboardingFee,
      paymentMethod: 'mpesa',
      mpesaCode: mpesaCode,
      phone: user.phone,
      status: 'verified',
      notes: `Account activation for ${user.name}`
    });
    await activation.save();

    res.json({
      success: true,
      message: 'Payment verified! Account activated.',
      data: {
        user: {
          id: user._id,
          name: user.name,
          role: user.role,
          status: user.status
        }
      }
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Payment verification failed',
      error: error.message
    });
  }
}

/**
 * Get payment instructions WITH JWT token (original method)
 */
static async getPaymentInstructions(req, res) {
  try {
    const user = await User.findById(req.user.id);
    
    if (user.status === 'active') {
      return res.json({
        success: true,
        message: 'Account already active',
        data: { paymentRequired: false }
      });
    }

    const instructions = {
      paymentRequired: true,
      amount: user.onboardingFee,
      paybill: "247247",
      accountNumber: user.phone,
      instructions: `Send KSH ${user.onboardingFee} to Paybill 247247, Account: ${user.phone}`
    };

    res.json({
      success: true,
      message: 'Payment instructions',
      data: instructions
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get payment instructions',
      error: error.message
    });
  }
}
  /**
   * M-Pesa payment verification (mock)
   */
  static async verifyMpesaPayment(mpesaCode, expectedAmount, phone) {
    console.log(`Verifying payment: ${mpesaCode}, Amount: ${expectedAmount}, Phone: ${phone}`);
    await new Promise(resolve => setTimeout(resolve, 500));
    return mpesaCode && mpesaCode.length >= 8;
  }
}

// ✅ CORRECT EXPORT - Make sure this is at the end
export default AuthController;