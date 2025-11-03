// src/middleware/validationMiddleware.js
import validator from 'validator';

class ValidationMiddleware {
  /**
   * Validate user registration data
   */
  static validateRegister(req, res, next) {
    const { name, phone, email, password, pin, role, county } = req.body;

    // Check required fields
    if (!name || !phone || !email || !password || !pin || !role) {
      return res.status(400).json({
        success: false,
        message: 'All fields are required: name, phone, email, password, pin, role'
      });
    }

    // Validate name
    if (name.length < 2 || name.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'Name must be between 2 and 50 characters'
      });
    }

    // Validate phone (Kenyan format)
    const phoneRegex = /^254[17]\d{8}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use 254XXXXXXXXX'
      });
    }

    // Validate email
    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email address'
      });
    }

    // Validate password
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    // Validate PIN
    const pinRegex = /^\d{4,6}$/;
    if (!pinRegex.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be 4-6 digits'
      });
    }

    // Validate role
    const validRoles = ['farmer', 'attendant', 'admin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role. Must be: farmer, attendant, or admin'
      });
    }

    // Validate county if provided
    if (county && county.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'County name too long'
      });
    }

    next();
  }
// In validationMiddleware.js - ADD THESE VALIDATIONS
static validatePublicPayment(req, res, next) {
  const { phone, mpesaCode } = req.body;

  if (!phone || !mpesaCode) {
    return res.status(400).json({
      success: false,
      message: 'Phone number and M-Pesa code are required'
    });
  }

  if (!/^254\d{9}$/.test(phone)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid Kenyan phone number (254...)'
    });
  }

  if (mpesaCode.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid M-Pesa code'
    });
  }

  next();
}
/**
 * Validate phone login data
 */
static validatePhoneLogin(req, res, next) {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({
      success: false,
      message: 'Phone number and password are required'
    });
  }

  // Validate phone (Kenyan format)
  const phoneRegex = /^254[17]\d{8}$/;
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({
      success: false,
      message: 'Invalid phone number format. Use 254XXXXXXXXX'
    });
  }

  // Validate password
  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 6 characters'
    });
  }

  next();
}
static validatePhone(req, res, next) {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      success: false,
      message: 'Phone number is required'
    });
  }

  if (!/^254\d{9}$/.test(phone)) {
    return res.status(400).json({
      success: false,
      message: 'Please provide a valid Kenyan phone number (254...)'
    });
  }

  next();
}
  /**
   * Validate login data
   */
  static validateLogin(req, res, next) {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    if (!validator.isEmail(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    next();
  }

  /**
   * Validate PIN for transactions
   */
  static validatePin(req, res, next) {
    const { pin } = req.body;

    if (!pin) {
      return res.status(400).json({
        success: false,
        message: 'PIN is required'
      });
    }

    const pinRegex = /^\d{4,6}$/;
    if (!pinRegex.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be 4-6 digits'
      });
    }

    next();
  }

  /**
   * Validate profile update data
   */
  static validateProfileUpdate(req, res, next) {
    const { name, county } = req.body;

    if (name && (name.length < 2 || name.length > 50)) {
      return res.status(400).json({
        success: false,
        message: 'Name must be between 2 and 50 characters'
      });
    }

    if (county && county.length > 50) {
      return res.status(400).json({
        success: false,
        message: 'County name too long'
      });
    }

    next();
  }

  /**
   * Validate M-Pesa payment verification
   */
  static validatePayment(req, res, next) {
    const { mpesaCode } = req.body;

    if (!mpesaCode) {
      return res.status(400).json({
        success: false,
        message: 'M-Pesa transaction code is required'
      });
    }

    if (mpesaCode.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Invalid M-Pesa transaction code'
      });
    }

    next();
  }
}

export default ValidationMiddleware;