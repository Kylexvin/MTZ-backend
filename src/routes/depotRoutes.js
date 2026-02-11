import express from 'express';
import DepotController from '../controllers/depotController.js';
import AuthMiddleware from '../middleware/authMiddleware.js';

const router = express.Router();

// ====================
// ADMIN ROUTES - Depot management
// ====================

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

// ====================
// ATTENDANT ROUTES - Depot-specific operations
// ====================

// ✅ Farmer lookup by phone (No depot-specific)
router.get('/farmer/lookup',
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  DepotController.findFarmerByPhone
);

// ✅ DEPOT-SPECIFIC ROUTES WITH ISOLATION
router.post('/:depotId/deposit/record', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.recordMilkDeposit
);

router.get('/:depotId/deposit/pending', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.getPendingDeposits
);

router.post('/:depotId/deposit/pay', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(), 
  DepotController.processTokenPayment
);

// ====================
// DASHBOARD & TRANSACTIONS
// ====================

router.get('/:depotId/dashboard', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(), 
  DepotController.getDepotDashboard
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

// ====================
// KCC OPERATIONS
// ====================

router.post('/:depotId/kcc-pickup', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(), 
  DepotController.kccPickup
);

router.post('/:depotId/kcc-delivery', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(), 
  DepotController.kccDelivery
);

// ====================
// NEW: PICKUP SIGNAL SYSTEM (Depot Attendant)
// ====================

// Signal pickup availability
router.post('/:depotId/pickup-signal', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.signalPickupAvailable
);

// Cancel pickup signal
router.delete('/:depotId/pickup-signal', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.cancelPickupSignal
);

// Get pickup signal status
router.get('/:depotId/pickup-signal', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.getPickupSignalStatus
);

// Clear pickup signal after collection (internal/auto)
router.post('/:depotId/pickup-signal/clear', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.clearPickupSignalAfterPickup
);

// ====================
// NEW: INVENTORY SCREEN ENDPOINTS
// ====================

// 1. Get current stock levels
router.get('/:depotId/inventory', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.getInventoryData
);

// 2. Get recent KCC operations
router.get('/:depotId/operations/recent', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.getRecentKccOperations
);

// 3. Get pending KCC operations
router.get('/:depotId/operations/pending', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.getPendingKccOperations
);

// 4. Get stock alerts
router.get('/:depotId/alerts', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.getStockAlerts
);

// 5. Combined endpoint for Inventory screen (one call gets everything)
router.get('/:depotId/inventory-screen', 
  AuthMiddleware.protect,
  AuthMiddleware.authorize('attendant'), 
  AuthMiddleware.requireAssignedDepot(),
  DepotController.getInventoryScreenData
);

export default router;