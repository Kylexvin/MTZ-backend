import express from 'express';
import KccController from '../controllers/kccController.js';
import AuthMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// ========================
// 👨‍💼 ADMIN ROUTES (System Admin)
// ========================

// Create KCC branch (System Admin only)
router.post('/branches',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('admin'),
  KccController.createKccBranch
);

// Get all KCC branches (System Admin only)
router.get('/branches',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('admin'),
  KccController.getAllKccBranches
);

// ========================
// 🏭 KCC ADMIN ROUTES (KCC Branch Manager)
// ========================

// Create KCC attendant (KCC Admin only) - Auto-assigned to admin's branch
router.post('/attendants',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_admin'),
  AuthMiddleware.requireAssignedKcc(),
  KccController.createKccAttendant
);

// Transfer tokens to attendant (KCC Admin only) - Same branch verification
router.post('/transfer-tokens',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_admin'),
  AuthMiddleware.requireAssignedKcc(),
  AuthMiddleware.requireSameKccBranch(),
  KccController.transferTokensToAttendant
);

// Get KCC branch details (KCC Admin only) - Their own branch only
router.get('/branch-details',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_admin'),
  AuthMiddleware.requireAssignedKcc(),
  KccController.getKccDetails
);

// ========================
// 🚚 KCC ATTENDANT ROUTES (KCC Workers)
// ========================

// ✅ UPDATED: 2-Step KCC Pickup Process
router.post('/pickup/record',  // STEP 1: Record pickup (collect milk)
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_attendant'),
  AuthMiddleware.requireAssignedKcc(),
  KccController.recordKccPickup
);

router.post('/pickup/pay',  // STEP 2: Process payment
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_attendant'),
  AuthMiddleware.requireAssignedKcc(),
  KccController.processKccPayment
);

// ========================
// 🆕 NEW: PICKUP SIGNAL SYSTEM (KCC Attendant)
// ========================

// Get available pickup signals in KCC attendant's county
router.get('/pickups/available',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_attendant'),
  AuthMiddleware.requireAssignedKcc(),
  KccController.getAvailablePickups
);

// Accept a pickup signal (claim it)
router.post('/pickup-signals/:signalId/accept',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_attendant'),
  AuthMiddleware.requireAssignedKcc(),
  KccController.acceptPickupSignal
);

// Get currently accepted pickup
router.get('/pickups/accepted',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_attendant'),
  AuthMiddleware.requireAssignedKcc(),
  KccController.getAcceptedPickup
);

// Complete pickup signal after collection
router.post('/pickup-signals/:signalId/complete',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_attendant'),
  AuthMiddleware.requireAssignedKcc(),
  KccController.completePickupSignal
);

// Release pickup signal (if can't fulfill)
router.delete('/pickup-signals/:signalId/release',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_attendant'),
  AuthMiddleware.requireAssignedKcc(),
  KccController.releasePickupSignal
);

// ========================
// 🏪 DEPOT ATTENDANT ROUTES 
// ========================

// Get available KCC branches for delivery requests
router.get('/delivery/branches',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'),
  KccController.getAvailableKccBranches
);

// Depot requests KCC delivery (specifies which KCC branch)
router.post('/delivery/request',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'),
  AuthMiddleware.requireAssignedDepot(),
  KccController.requestKccDelivery
);

// ========================
// 🚚 KCC ATTENDANT DELIVERY ROUTES
// ========================

// KCC attendants see delivery requests for THEIR branch only
router.get('/delivery/requests',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_attendant'),
  AuthMiddleware.requireAssignedKcc(),
  KccController.getMyDeliveryRequests
);

// KCC confirms delivery (only for THEIR branch requests)
router.post('/delivery/confirm',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('kcc_attendant'),
  AuthMiddleware.requireAssignedKcc(),
  KccController.confirmKccDelivery
);

export default router;