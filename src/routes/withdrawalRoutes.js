import express from 'express';
import WithdrawalController from '../controllers/withdrawalController.js';
import AuthMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/milk', AuthMiddleware.protect, WithdrawalController.withdrawMilk);

export default router;