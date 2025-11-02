// src/routes/walletRoutes.js
import express from 'express';
import WalletController from '../controllers/walletController.js';
import AuthMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(AuthMiddleware.protect);

// User wallet operations
router.get('/balance', WalletController.getWalletBalance);
router.get('/transactions', WalletController.getTransactionHistory);
router.post('/transfer', WalletController.transferTokens);
router.post('/calculate', WalletController.calculateValue);

// Admin-only route
router.post('/transfer-float', AuthMiddleware.authorize('admin'), WalletController.transferFloat);

// Public token metrics
router.get('/metrics', WalletController.getTokenMetrics);

// Admin-only operations
router.patch('/price', AuthMiddleware.authorize('admin'), WalletController.updateUniversalPrice);
router.get('/activity', AuthMiddleware.authorize('admin'), WalletController.getTokenActivity);

export default router;
