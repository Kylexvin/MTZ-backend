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



// In kccRoutes.js - ADD THIS:

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
// 🚚 KCC ATTENDANT ROUTES
// ========================

// KCC attendants see requests for THEIR branch only
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