import express from 'express';
import MpesaController from '../controllers/mpesaController.js';
import AuthMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/redeem', AuthMiddleware.protect, MpesaController.cashRedemption);
router.post('/callback', MpesaController.mpesaCallback);

export default router;