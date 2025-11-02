import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Kcc from '../models/Kcc.js';
import Depot from '../models/Depot.js';

class AuthMiddleware {
  /**
   * Protect routes - verify JWT token
   */
  static async protect(req, res, next) {
    try {
      let token;

      // Check for token in header
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
      }

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Access denied. No token provided.'
        });
      }

      try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'milkbank_fallback_secret');
        
        // Check if user still exists
        const user = await User.findById(decoded.userId);
        if (!user) {
          return res.status(401).json({
            success: false,
            message: 'User no longer exists.'
          });
        }

        // Allow pending users to access verification routes
        const verificationRoutes = ['/verify-payment', '/payment-instructions'];
        const isVerificationRoute = verificationRoutes.some(route => req.path.includes(route));

        if (user.status !== 'active' && !isVerificationRoute) {
          return res.status(401).json({
            success: false,
            message: 'Account is not active. Please complete verification.'
          });
        }

        // Grant access to protected route
        req.user = user;
        next();
      } catch (error) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token.'
        });
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Authentication failed',
        error: error.message
      });
    }
  }

  /**
   * Authorize by roles
   */
  static authorize(...roles) {
    return (req, res, next) => {
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: `User role ${req.user.role} is not authorized to access this route`
        });
      }
      next();
    };
  }

  /**
   * ✅ NEW: Ensure KCC admin/attendant can only access their assigned branch
   */
  static requireAssignedKcc() {
    return async (req, res, next) => {
      try {
        const user = req.user;
        
        // Only apply to KCC roles
        if (!user.isKccAdmin() && !user.isKccAttendant()) {
          return next();
        }

        if (!user.assignedKcc) {
          return res.status(403).json({
            success: false,
            message: 'User not assigned to any KCC branch'
          });
        }

        // For KCC-specific operations, verify they belong to the correct branch
        const kccBranchId = req.params.kccId || req.body.kccId;
        if (kccBranchId && kccBranchId !== user.assignedKcc.toString()) {
          return res.status(403).json({
            success: false,
            message: 'Not authorized to access this KCC branch'
          });
        }

        // Attach KCC branch info to request for convenience
        const kccBranch = await Kcc.findById(user.assignedKcc);
        if (!kccBranch) {
          return res.status(404).json({
            success: false,
            message: 'Assigned KCC branch not found'
          });
        }

        req.kccBranch = kccBranch;
        next();
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'KCC branch verification failed',
          error: error.message
        });
      }
    };
  }

  /**
   * ✅ NEW: Ensure depot attendant can only access their assigned depot
   */
  static requireAssignedDepot() {
    return async (req, res, next) => {
      try {
        const user = req.user;
        
        // Only apply to depot attendants
        if (!user.isAttendant()) {
          return next();
        }

        if (!user.assignedDepot) {
          return res.status(403).json({
            success: false,
            message: 'User not assigned to any depot'
          });
        }

        // For depot-specific operations, verify they belong to the correct depot
        const depotId = req.params.depotId || req.body.depotId;
        if (depotId && depotId !== user.assignedDepot.toString()) {
          return res.status(403).json({
            success: false,
            message: 'Not authorized to access this depot'
          });
        }

        // Attach depot info to request for convenience
        const depot = await Depot.findById(user.assignedDepot);
        if (!depot) {
          return res.status(404).json({
            success: false,
            message: 'Assigned depot not found'
          });
        }

        req.depot = depot;
        next();
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'Depot verification failed',
          error: error.message
        });
      }
    };
  }

  /**
   * ✅ NEW: Verify KCC attendant belongs to same branch as KCC admin for token transfers
   */
  static requireSameKccBranch() {
    return async (req, res, next) => {
      try {
        const kccAdmin = req.user;
        
        if (!kccAdmin.isKccAdmin()) {
          return res.status(403).json({
            success: false,
            message: 'Only KCC admins can perform this action'
          });
        }

        const { attendantId } = req.body;
        if (!attendantId) {
          return res.status(400).json({
            success: false,
            message: 'Attendant ID is required'
          });
        }

        // Verify attendant exists and belongs to same KCC branch
        const attendant = await User.findById(attendantId);
        if (!attendant || !attendant.isKccAttendant()) {
          return res.status(404).json({
            success: false,
            message: 'KCC attendant not found'
          });
        }

        if (attendant.assignedKcc.toString() !== kccAdmin.assignedKcc.toString()) {
          return res.status(403).json({
            success: false,
            message: 'Cannot transfer tokens to attendant from different KCC branch'
          });
        }

        req.attendant = attendant;
        next();
      } catch (error) {
        res.status(500).json({
          success: false,
          message: 'KCC branch verification failed',
          error: error.message
        });
      }
    };
  }

  /**
   * Check if user has active status
   */
  static requireActive(req, res, next) {
    if (req.user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: 'Account not active. Please complete verification.'
      });
    }
    next();
  }
}

export default AuthMiddleware;