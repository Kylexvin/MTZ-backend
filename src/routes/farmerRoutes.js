import express from 'express';
import FarmerController from '../controllers/farmerController.js';
import AuthMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// All farmer routes require authentication and farmer role
router.use(AuthMiddleware.protect, AuthMiddleware.authorize('farmer'));

// ========================
// 🥛 MILK DEPOSIT ROUTES
// ========================
router.get('/deposits', FarmerController.getFarmerDepositHistory);
router.get('/deposits/summary', FarmerController.getDepositSummary);
router.get('/deposits/:depositId', FarmerController.getDepositDetails);

// ========================
// 🥛 MILK WITHDRAWAL ROUTES  ✅ ADD THIS SECTION
// ========================
router.post('/withdraw-milk', FarmerController.withdrawMilk);

// ========================
// 📊 DASHBOARD ROUTES
// ========================
router.get('/dashboard', FarmerController.getDepositSummary);

export default router;