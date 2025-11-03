// src/routes/authRoutes.js
import express from 'express';
import AuthController from '../controllers/authController.js';
import AuthMiddleware from '../middleware/authMiddleware.js';
import ValidationMiddleware from '../middleware/validationMiddleware.js';

const router = express.Router();

/**
 * 🔐 Authentication Routes
 * Handles user registration, login, payment, and profile management
 */

// 🟢 Public Routes - No authentication required
router.post('/register', 
  ValidationMiddleware.validateRegister, 
  AuthController.register
);

router.post('/login', 
  ValidationMiddleware.validateLogin, 
  AuthController.login
);
router.post('/login-phone', 
  ValidationMiddleware.validatePhoneLogin, // Add this validation
  AuthController.loginWithPhone
);
// ✅ ADD PUBLIC PAYMENT ROUTES (No token required)
router.post('/verify-payment-public', 
  ValidationMiddleware.validatePublicPayment,
  AuthController.verifyPaymentPublic
);

router.post('/payment-instructions-public', 
  ValidationMiddleware.validatePhone,
  AuthController.getPaymentInstructionsPublic
);

// 🔐 Protected Routes - Require valid JWT token
router.post('/verify-pin', 
  AuthMiddleware.protect, 
  ValidationMiddleware.validatePin, 
  AuthController.verifyPin
);

router.post('/verify-payment', 
  AuthMiddleware.protect, 
  ValidationMiddleware.validatePayment,
  AuthController.verifyPayment
);

router.get('/payment-instructions', 
  AuthMiddleware.protect, 
  AuthController.getPaymentInstructions
);

router.get('/profile', 
  AuthMiddleware.protect, 
  AuthController.getProfile
);

router.put('/profile', 
  AuthMiddleware.protect, 
  ValidationMiddleware.validateProfileUpdate,
  AuthController.updateProfile
);

// 👨‍💼 Admin Routes
router.post('/register-kcc-admin',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('admin'),
  AuthController.registerKccAdmin
);

export default router;