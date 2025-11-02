import express from 'express';
import AuthMiddleware from '../middleware/authMiddleware.js';
import FeeController from '../controllers/feeController.js'; // 👈 Import fee controller

const router = express.Router();

// All admin routes require authentication and admin role
router.use(AuthMiddleware.protect, AuthMiddleware.authorize('admin'));

// ========================
// 💰 FEE MANAGEMENT
// ========================
router.get('/fees/settings', FeeController.getFeeSettings);
router.patch('/fees/p2p', FeeController.updateP2PFees);
router.patch('/fees/redemption', FeeController.updateRedemptionFees);
router.get('/fees/stats', FeeController.getFeeStats);

// ========================
// 📊 SYSTEM OVERVIEW
// ========================
router.get('/overview', (req, res) => {
  res.json({
    success: true,
    message: 'Admin overview endpoint - to be implemented'
  });
});

// ========================
// 👥 USER MANAGEMENT
// ========================
router.get('/users', (req, res) => {
  res.json({
    success: true,
    message: 'User management endpoint - to be implemented'
  });
});

// ========================
// 🏭 DEPOT MANAGEMENT
// ========================
router.get('/depots', (req, res) => {
  res.json({
    success: true,
    message: 'Depot management endpoint - to be implemented'
  });
});

export default router;