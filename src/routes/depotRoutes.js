import express from 'express';
import DepotController from '../controllers/depotController.js';
import AuthMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// Admin routes - Depot management (No isolation needed for admins)
router.post('/', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('admin'),
  DepotController.createDepot
);

router.get('/',
  AuthMiddleware.protect,
  DepotController.getAllDepots
);

router.get('/:id',
  AuthMiddleware.protect,
  DepotController.getDepot
);

router.put('/:id',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('admin'),
  DepotController.updateDepot
);

router.post('/:id/assign-attendant',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('admin'),
  DepotController.assignAttendant
);

// ✅ UPDATED: Farmer lookup by phone (No depot-specific)
router.get('/farmer/lookup',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  DepotController.findFarmerByPhone
);

// ✅ UPDATED: Depot-specific routes WITH ISOLATION
router.post('/:depotId/deposit/record', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(), // ✅ ADD THIS
  DepotController.recordMilkDeposit
);

router.get('/:depotId/deposit/pending', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(), // ✅ ADD THIS
  DepotController.getPendingDeposits
);
router.get('/:depotId/transactions', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.getDepotTransactions
);
router.get('/:depotId/today-stats', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.getTodayStats
);

router.post('/:depotId/deposit/pay', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(), // ✅ ADD THIS
  DepotController.processTokenPayment
);

// ✅ UPDATED: KCC operations WITH ISOLATION
router.post('/:depotId/kcc-pickup', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(), // ✅ ADD THIS
  DepotController.kccPickup
);

router.post('/:depotId/kcc-delivery', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(), // ✅ ADD THIS
  DepotController.kccDelivery
);


// ✅ UPDATED: Depot dashboard WITH ISOLATION
router.get('/:depotId/dashboard', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(), // ✅ ADD THIS
  DepotController.getDepotDashboard
);

export default router;