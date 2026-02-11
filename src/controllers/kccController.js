// kccController.js
import mongoose from 'mongoose';
import Kcc from '../models/Kcc.js';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import Depot from '../models/Depot.js';
import DeliveryRequest from '../models/DeliveryRequest.js'; 

class KccController {
  
  /**
   * Create KCC branch (Admin only)
   */
  static async createKccBranch(req, res) {
    try {
      const { name, code, location, contact } = req.body;
      
      // Check if KCC code already exists
      const existingKcc = await Kcc.findByCode(code);
      if (existingKcc) {
        return res.status(400).json({
          success: false,
          message: `KCC branch with code ${code} already exists`
        });
      }
      
      const kcc = await Kcc.create({
        name,
        code: code.toUpperCase(),
        location,
        contact
      });
      
      res.status(201).json({
        success: true,
        message: `KCC branch ${name} created successfully`,
        data: { kcc }
      });
      
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to create KCC branch',
        error: error.message
      });
    }
  }
  
  /**
   * Create KCC attendant (KCC Admin only)
   */
  static async createKccAttendant(req, res) {
    try {
      const { name, phone, email, password, pin, county } = req.body;
      const kccAdminId = req.user.id;
      
      // Verify requester is KCC admin and get their KCC branch
      const kccAdmin = await User.findById(kccAdminId);
      if (!kccAdmin.isKccAdmin()) {
        return res.status(403).json({
          success: false,
          message: 'Only KCC admins can create attendants'
        });
      }
      
      if (!kccAdmin.assignedKcc) {
        return res.status(400).json({
          success: false,
          message: 'KCC admin not assigned to any KCC branch'
        });
      }
      
      // Create KCC attendant user
      const attendant = await User.createUser({
        name,
        phone,
        email,
        password,
        pin,
        role: 'kcc_attendant',
        assignedKcc: kccAdmin.assignedKcc,
        county: county || kccAdmin.county,
        status: 'active',
        paymentStatus: 'verified' // KCC staff don't pay onboarding
      });
      
      // Create wallet for the attendant
      await Wallet.getOrCreateWallet(attendant._id);
      
      res.status(201).json({
        success: true,
        message: `KCC attendant ${name} created successfully`,
        data: { 
          attendant: { 
            id: attendant._id,
            name: attendant.name,
            phone: attendant.phone,
            email: attendant.email,
            role: attendant.role,
            assignedKcc: attendant.assignedKcc
          } 
        }
      });
      
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to create KCC attendant',
        error: error.message
      });
    }
  }
  
  /**
   * Transfer tokens from KCC admin to attendant (KCC Admin only)
   */
  static async transferTokensToAttendant(req, res) {
    try {
      const { attendantId, tokenAmount } = req.body;
      const kccAdminId = req.user.id;
      
      // Verify requester is KCC admin
      const kccAdmin = await User.findById(kccAdminId);
      if (!kccAdmin.isKccAdmin()) {
        return res.status(403).json({
          success: false,
          message: 'Only KCC admins can transfer tokens'
        });
      }
      
      // Get KCC branch info
      const kccBranch = await Kcc.findById(kccAdmin.assignedKcc);
      if (!kccBranch) {
        return res.status(404).json({
          success: false,
          message: 'KCC branch not found'
        });
      }
      
      // Verify attendant belongs to same KCC branch
      const attendant = await User.findById(attendantId);
      if (!attendant || !attendant.isKccAttendant() || 
          attendant.assignedKcc.toString() !== kccAdmin.assignedKcc.toString()) {
        return res.status(404).json({
          success: false,
          message: 'KCC attendant not found in your branch'
        });
      }
      
      // Transfer tokens from KCC admin to attendant
      const transferResult = await Wallet.transferTokens(
        kccAdminId,
        attendantId,
        tokenAmount,
        `KCC float allocation to ${attendant.name}`
      );
      
      res.json({
        success: true,
        message: `${tokenAmount} MTZ transferred to KCC attendant ${attendant.name}`,
        data: {
          kccBranch: {
            name: kccBranch.name,
            code: kccBranch.code
          },
          attendant: {
            name: attendant.name,
            phone: attendant.phone,
            newBalance: transferResult.toBalance
          },
          adminBalance: transferResult.fromBalance
        }
      });
      
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Token transfer failed',
        error: error.message
      });
    }
  }
  
/**
 * Record KCC pickup - STEP 1 (Physical milk collection)
 */
static async recordKccPickup(req, res) {
  try {
    const { depotId, litersRaw } = req.body;
    const kccAttendantId = req.user.id;
    
    // Verify requester is KCC attendant and get their branch
    const kccAttendant = await User.findById(kccAttendantId).populate('assignedKcc');
    if (!kccAttendant || kccAttendant.role !== 'kcc_attendant') {
      return res.status(403).json({
        success: false,
        message: 'Only KCC attendants can record pickups'
      });
    }

    // Verify KCC branch is assigned and active
    if (!kccAttendant.assignedKcc || kccAttendant.assignedKcc.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'KCC attendant not assigned to an active branch'
      });
    }

    // ✅ NEW: Check for pending transactions FIRST
    const pendingPickups = await Transaction.find({
      kccAttendant: kccAttendantId,
      type: 'kcc_pickup', 
      status: 'pending'
    });
    
    if (pendingPickups.length > 0) {
      const totalPendingLiters = pendingPickups.reduce((sum, tx) => sum + tx.litersRaw, 0);
      const totalPendingCost = totalPendingLiters; // 1L = 1 MTZ
      
      return res.status(400).json({
        success: false,
        message: `You have ${pendingPickups.length} unpaid pickup(s)`,
        data: {
          pendingDetails: {
            count: pendingPickups.length,
            totalLiters: totalPendingLiters,
            totalCost: totalPendingCost,
            transactions: pendingPickups.map(tx => ({
              transactionId: tx._id,
              liters: tx.litersRaw,
              depot: tx.depot,
              createdAt: tx.createdAt
            }))
          },
          actionRequired: 'Please pay for existing pickups before collecting more milk'
        }
      });
    }

    // Find depot and its attendant
    const [depot, depotAttendant] = await Promise.all([
      Depot.findById(depotId),
      User.findOne({ assignedDepot: depotId, role: 'attendant', status: 'active' })
    ]);

    if (!depot) {
      return res.status(404).json({
        success: false,
        message: 'Depot not found'
      });
    }

    if (!depotAttendant) {
      return res.status(400).json({
        success: false,
        message: 'No active attendant assigned to this depot'
      });
    }

    // Check depot has enough raw milk
    if (depot.stock.rawMilk < litersRaw) {
      return res.status(400).json({
        success: false,
        message: `Depot insufficient raw milk. Available: ${depot.stock.rawMilk}L, Requested: ${litersRaw}L`
      });
    }

    // ✅ NEW: Check KCC wallet balance and show comparison
    const kccWallet = await Wallet.getOrCreateWallet(kccAttendantId);
    const currentBalance = kccWallet.getBalance();
    const pickupCost = litersRaw; // 1L = 1 MTZ
    
    if (currentBalance < pickupCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient tokens for this pickup`,
        data: {
          walletComparison: {
            yourBalance: currentBalance,
            pickupCost: pickupCost,
            shortfall: pickupCost - currentBalance,
            canAfford: false
          },
          suggestion: `You need ${pickupCost - currentBalance} more MTZ to collect ${litersRaw}L`
        }
      });
    }

    // Show wallet comparison even if they CAN afford
    const walletInfo = {
      yourBalance: currentBalance,
      pickupCost: pickupCost,
      remainingAfterPayment: currentBalance - pickupCost,
      canAfford: true
    };

    // Use the new removeMilkStock method
    const stockResult = await depot.removeMilkStock(litersRaw, 'raw');
    if (!stockResult.success) {
      return res.status(400).json({
        success: false,
        message: stockResult.error
      });
    }

    // Create PENDING KCC pickup transaction
    const pickupTx = await Transaction.create({
      type: 'kcc_pickup',
      fromUser: depotAttendant._id,
      toUser: kccAttendantId,
      attendant: kccAttendantId,
      kccAttendant: kccAttendantId,
      depot: depotId,
      litersRaw: litersRaw,
      tokensAmount: 0, // Will be set during payment
      status: 'pending', // Waiting for payment
      notes: `KCC pickup recorded - ${litersRaw}L raw milk collected from ${depot.name}`
    });

    // Get updated depot data after stock removal
    const updatedDepot = await Depot.findById(depotId);

    res.json({
      success: true,
      message: `${litersRaw}L raw milk collected from ${depot.name}`,
      data: {
        walletInfo: walletInfo, // ✅ NEW: Show wallet comparison
        pickupRecord: {
          transactionId: pickupTx._id,
          reference: pickupTx.reference,
          depot: {
            name: depot.name,
            code: depot.code
          },
          liters: litersRaw,
          cost: pickupCost, // ✅ NEW: Show cost
          depotRemainingStock: updatedDepot.stock.rawMilk,
          status: 'pending_payment',
          nextStep: 'Process payment to complete transaction'
        }
      }
    });
  } catch (error) {
    console.error('KCC pickup error:', error);
    res.status(500).json({
      success: false,
      message: 'KCC pickup failed',
      error: error.message
    });
  }
}
  
/**
 * Process KCC payment - STEP 2 (Pay for collected milk)
 */
static async processKccPayment(req, res) {
  try {
    const { transactionId } = req.body;
    const kccAttendantId = req.user.id;

    // Find pending KCC pickup
    const pickupTx = await Transaction.findOne({
      _id: transactionId,
      kccAttendant: kccAttendantId,
      type: 'kcc_pickup',
      status: 'pending'
    }).populate('fromUser depot');

    if (!pickupTx) {
      return res.status(404).json({
        success: false,
        message: 'Pending KCC pickup not found'
      });
    }

    const liters = pickupTx.litersRaw;
    const depotAttendantId = pickupTx.fromUser;

    // Check KCC attendant has enough tokens
    const kccWallet = await Wallet.getOrCreateWallet(kccAttendantId);
    const currentBalance = kccWallet.getBalance();
    
    if (currentBalance < liters) {
      return res.status(400).json({
        success: false,
        message: `Insufficient tokens to complete payment`,
        data: {
          paymentDetails: {
            required: liters,
            available: currentBalance,
            shortfall: liters - currentBalance
          },
          suggestion: 'Please top up your wallet or contact KCC admin for token transfer'
        }
      });
    }

    // Transfer payment
    const paymentResult = await Wallet.transferTokens(
      kccAttendantId,
      depotAttendantId,
      liters,
      `Payment for ${liters}L raw milk pickup`
    );

    // Update transaction
    pickupTx.tokensAmount = liters;
    pickupTx.status = 'completed';
    pickupTx.notes = `Payment completed - ${liters} MTZ paid`;
    await pickupTx.save();

    res.json({
      success: true,
      message: `${liters} MTZ paid for ${liters}L raw milk`,
      data: {
        paymentReceipt: {
          transactionId: pickupTx.reference,
          liters: liters,
          cost: liters, // ✅ NEW: Show cost clearly
          kccAttendantBalance: paymentResult.fromBalance,
          depotAttendantBalance: paymentResult.toBalance,
          status: 'completed'
        },
        // ✅ NEW: Show updated wallet status
        walletStatus: {
          previousBalance: currentBalance,
          newBalance: paymentResult.fromBalance,
          amountSpent: liters
        }
      }
    });
  } catch (error) {
    console.error('KCC payment error:', error);
    res.status(400).json({
      success: false,
      message: 'Payment failed',
      error: error.message
    });
  }
}

/**
 * Get available KCC branches for depot attendants
 */
static async getAvailableKccBranches(req, res) {
  try {
    const depotAttendantId = req.user.id;

    // Verify requester is depot attendant
    const depotAttendant = await User.findById(depotAttendantId);
    if (!depotAttendant || depotAttendant.role !== 'attendant') {
      return res.status(403).json({
        success: false,
        message: 'Only depot attendants can access KCC branches'
      });
    }

    // Get depot location to find nearby KCC branches
    const depot = await Depot.findById(depotAttendant.assignedDepot);
    if (!depot) {
      return res.status(400).json({
        success: false,
        message: 'No depot assigned to this attendant'
      });
    }

    // Find active KCC branches (could enhance with location-based filtering)
    const availableBranches = await Kcc.findActiveBranches();

    // Get branch stats (attendants count, recent activity)
    const branchesWithStats = await Promise.all(
      availableBranches.map(async (branch) => {
        const attendantCount = await User.countDocuments({
          assignedKcc: branch._id,
          role: 'kcc_attendant',
          status: 'active'
        });

        return {
          id: branch._id,
          name: branch.name,
          code: branch.code,
          location: branch.location,
          contact: branch.contact,
          attendantsAvailable: attendantCount,
          deliveryHint: attendantCount > 0 ? 'Ready for delivery' : 'No attendants available'
        };
      })
    );

    res.json({
      success: true,
      message: `Found ${branchesWithStats.length} available KCC branches`,
      data: {
        yourDepot: {
          name: depot.name,
          location: depot.location
        },
        availableBranches: branchesWithStats
      }
    });

  } catch (error) {
    console.error('Get KCC branches error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get KCC branches',
      error: error.message
    });
  }
}
/**
 * STEP 1: Depot requests delivery FROM SPECIFIC KCC BRANCH
 */
static async requestKccDelivery(req, res) {
  try {
    const { litersPasteurized, kccBranchId } = req.body; // ✅ SPECIFY KCC BRANCH!
    const depotAttendantId = req.user.id;

    // Verify requester is depot attendant
    const depotAttendant = await User.findById(depotAttendantId);
    if (!depotAttendant || depotAttendant.role !== 'attendant') {
      return res.status(403).json({
        success: false,
        message: 'Only depot attendants can request deliveries'
      });
    }

    // Get depot
    const depot = await Depot.findById(depotAttendant.assignedDepot);
    if (!depot) {
      return res.status(400).json({
        success: false,
        message: 'No depot assigned to this attendant'
      });
    }

    // ✅ ENHANCED: Verify KCC branch exists and is active
    const kccBranch = await Kcc.findById(kccBranchId);
    if (!kccBranch || kccBranch.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Selected KCC branch is not available'
      });
    }

    // Check depot capacity
    if (!depot.canAcceptDeposit(litersPasteurized)) {
      const availableSpace = depot.stock.capacity - depot.stock.pasteurizedMilk;
      return res.status(400).json({
        success: false,
        message: `Depot cannot accept ${litersPasteurized}L. Available space: ${availableSpace}L`
      });
    }

    // Check depot wallet balance
    const depotWallet = await Wallet.getOrCreateWallet(depotAttendantId);
    const depotBalance = depotWallet.getBalance();
    
    if (depotBalance < litersPasteurized) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient tokens for delivery',
        data: {
          walletComparison: {
            currentBalance: depotBalance,
            deliveryCost: litersPasteurized,
            shortfall: litersPasteurized - depotBalance,
            canAfford: false
          }
        }
      });
    }

    // ✅ ENHANCED: Get available KCC attendants for this branch
    const availableKccAttendants = await User.find({
      assignedKcc: kccBranchId,
      role: 'kcc_attendant',
      status: 'active'
    });

    // Create delivery request FOR SPECIFIC KCC BRANCH
    const deliveryRequest = await DeliveryRequest.create({
      depot: depot._id,
      depotAttendant: depotAttendantId,
      litersRequested: litersPasteurized,
      assignedKcc: kccBranchId, // ✅ SPECIFIC KCC BRANCH
      targetAttendants: availableKccAttendants.map(a => a._id), // ✅ WHO CAN FULFILL
      qrCode: DeliveryRequest.generateQRCode(),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
    });

    res.json({
      success: true,
      message: `Delivery request sent to ${kccBranch.name}`,
      data: {
        deliveryRequest: {
          id: deliveryRequest._id,
          qrCode: deliveryRequest.qrCode,
          liters: litersPasteurized,
          depot: depot.name,
          kccBranch: {
            id: kccBranch._id,
            name: kccBranch.name,
            location: kccBranch.location
          },
          availableAttendants: availableKccAttendants.length,
          expiresAt: deliveryRequest.expiresAt,
          walletInfo: {
            currentBalance: depotBalance,
            deliveryCost: litersPasteurized,
            remainingAfterPayment: depotBalance - litersPasteurized
          },
          instructions: 'Show QR code to KCC attendant when milk arrives'
        }
      }
    });

  } catch (error) {
    console.error('Delivery request error:', error);
    res.status(500).json({
      success: false,
      message: 'Delivery request failed',
      error: error.message
    });
  }
}

/**
 * STEP 2: KCC confirms delivery by scanning QR code (ONLY FOR THEIR BRANCH)
 */
static async confirmKccDelivery(req, res) {
  try {
    const { qrCode } = req.body;
    const kccAttendantId = req.user.id;

    // Verify KCC attendant and get their branch
    const kccAttendant = await User.findById(kccAttendantId).populate('assignedKcc');
    if (!kccAttendant || kccAttendant.role !== 'kcc_attendant') {
      return res.status(403).json({
        success: false,
        message: 'Only KCC attendants can confirm deliveries'
      });
    }

    // ✅ ENHANCED: Find valid delivery request FOR THEIR BRANCH ONLY
    const deliveryRequest = await DeliveryRequest.findOne({
      qrCode: qrCode,
      assignedKcc: kccAttendant.assignedKcc._id, // ✅ THEIR BRANCH ONLY
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).populate('depot depotAttendant');

    if (!deliveryRequest) {
      return res.status(400).json({
        success: false,
        message: 'Invalid QR code, expired, or not assigned to your branch'
      });
    }

    const liters = deliveryRequest.litersRequested;

    // Double-check depot can still accept and pay
    if (!deliveryRequest.depot.canAcceptDeposit(liters)) {
      return res.status(400).json({
        success: false,
        message: 'Depot no longer has capacity for this delivery'
      });
    }

    const depotWallet = await Wallet.getOrCreateWallet(deliveryRequest.depotAttendant._id);
    if (depotWallet.getBalance() < liters) {
      return res.status(400).json({
        success: false,
        message: 'Depot no longer has sufficient tokens'
      });
    }

    // PROCESS PAYMENT (depot → KCC)
    const paymentResult = await Wallet.transferTokens(
      deliveryRequest.depotAttendant._id,
      kccAttendantId,
      liters,
      `Payment for ${liters}L pasteurized milk delivery (QR: ${qrCode})`
    );

    // UPDATE DEPOT STOCK
    await deliveryRequest.depot.addMilkStock(liters, 'pasteurized');

    // CREATE TRANSACTION
    const deliveryTx = await Transaction.create({
      type: 'kcc_delivery',
      fromUser: kccAttendantId,
      toUser: deliveryRequest.depotAttendant._id,
      attendant: deliveryRequest.depotAttendant._id,
      kccAttendant: kccAttendantId,
      depot: deliveryRequest.depot._id,
      litersPasteurized: liters,
      tokensAmount: liters,
      status: 'completed',
      notes: `QR-verified delivery: ${qrCode} from ${kccAttendant.assignedKcc.name}`
    });

    // UPDATE DELIVERY REQUEST
    deliveryRequest.status = 'completed';
    deliveryRequest.completedBy = kccAttendantId;
    deliveryRequest.completedAt = new Date();
    deliveryRequest.transaction = deliveryTx._id;
    await deliveryRequest.save();

    res.json({
      success: true,
      message: `${liters}L pasteurized milk delivered successfully from ${kccAttendant.assignedKcc.name}`,
      data: {
        deliveryConfirmation: {
          transactionId: deliveryTx.reference,
          qrCode: qrCode,
          depot: deliveryRequest.depot.name,
          kccBranch: kccAttendant.assignedKcc.name,
          liters: liters,
          payment: {
            amount: liters,
            
            kccNewBalance: paymentResult.toBalance
          },
          stock: {
            previous: deliveryRequest.depot.stock.pasteurizedMilk - liters,
            new: deliveryRequest.depot.stock.pasteurizedMilk
          }
        }
      }
    });

  } catch (error) {
    console.error('Delivery confirmation error:', error);
    res.status(500).json({
      success: false,
      message: 'Delivery confirmation failed',
      error: error.message
    });
  }
}

/**
 * KCC attendants get delivery requests for THEIR branch
 */
static async getMyDeliveryRequests(req, res) {
  try {
    const kccAttendantId = req.user.id;
    
    const kccAttendant = await User.findById(kccAttendantId).populate('assignedKcc');
    if (!kccAttendant.assignedKcc) {
      return res.status(400).json({
        success: false,
        message: 'Not assigned to any KCC branch'
      });
    }

    const deliveryRequests = await DeliveryRequest.find({
      assignedKcc: kccAttendant.assignedKcc._id,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    }).populate('depot', 'name code location');

    res.json({
      success: true,
      message: `Found ${deliveryRequests.length} delivery requests for ${kccAttendant.assignedKcc.name}`,
      data: {
        myBranch: kccAttendant.assignedKcc.name,
        deliveryRequests: deliveryRequests.map(req => ({
          id: req._id,
          qrCode: req.qrCode,
          depot: req.depot.name,
          location: req.depot.location,
          liters: req.litersRequested,
          expiresIn: Math.round((req.expiresAt - new Date()) / 60000) + ' minutes'
        }))
      }
    });
  } catch (error) {
    console.error('Get delivery requests error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get delivery requests',
      error: error.message
    });
  }
}
 // Add these methods to your existing KccController class

/**
 * Get available pickup signals for KCC attendants (County-based)
 * GET /kcc/pickups/available
 */
static async getAvailablePickups(req, res) {
  try {
    const kccAttendantId = req.user.id;
    
    // Get KCC attendant and their branch
    const kccAttendant = await User.findById(kccAttendantId).populate('assignedKcc');
    if (!kccAttendant || !kccAttendant.assignedKcc) {
      return res.status(400).json({
        success: false,
        message: 'Not assigned to a KCC branch'
      });
    }
    
    const kccBranch = kccAttendant.assignedKcc;
    
    // Find available pickups in the same county as KCC branch
    const availablePickups = await Depot.findAvailablePickupsByCounty(kccBranch.location.county);
    
    // Format response
    const formattedPickups = await Promise.all(
      availablePickups.map(async (depot) => {
        // Calculate distance/time estimate (placeholder - could integrate maps API)
        const timeEstimate = '15-30 min'; // Placeholder
        
        return {
          signalId: depot._id, // Using depot ID as signal ID
          depot: {
            id: depot._id,
            name: depot.name,
            code: depot.code,
            location: depot.location,
            attendant: depot.assignedAttendant ? {
              name: depot.assignedAttendant.name,
              phone: depot.assignedAttendant.phone
            } : null
          },
          signal: {
            estimatedLiters: depot.pickupSignal.estimatedLiters,
            signaledAt: depot.pickupSignal.signaledAt,
            expiresAt: depot.pickupSignal.expiresAt,
            timeRemaining: Math.round((depot.pickupSignal.expiresAt - new Date()) / 60000) + ' minutes'
          },
          stock: {
            rawMilk: depot.stock.rawMilk,
            capacity: depot.stock.capacity,
            utilization: Math.round((depot.stock.rawMilk / depot.stock.capacity) * 100)
          },
          logistics: {
            estimatedTime: timeEstimate,
            county: depot.location.county,
            priority: depot.pickupSignal.estimatedLiters > 500 ? 'High' : 'Normal'
          }
        };
      })
    );
    
    res.json({
      success: true,
      message: `Found ${formattedPickups.length} available pickups in ${kccBranch.location.county}`,
      data: {
        myBranch: {
          name: kccBranch.name,
          county: kccBranch.location.county
        },
        availablePickups: formattedPickups
      }
    });
    
  } catch (error) {
    console.error('Get available pickups error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get available pickups',
      error: error.message
    });
  }
}

/**
 * Accept a pickup signal (KCC attendant claims it)
 * POST /kcc/pickup-signals/:signalId/accept
 */
static async acceptPickupSignal(req, res) {
  try {
    const { signalId } = req.params; // depotId
    const kccAttendantId = req.user.id;
    
    // Get KCC attendant and verify
    const kccAttendant = await User.findById(kccAttendantId).populate('assignedKcc');
    if (!kccAttendant || kccAttendant.role !== 'kcc_attendant') {
      return res.status(403).json({
        success: false,
        message: 'Only KCC attendants can accept pickups'
      });
    }
    
    const kccBranch = kccAttendant.assignedKcc;
    if (!kccBranch) {
      return res.status(400).json({
        success: false,
        message: 'KCC attendant not assigned to any branch'
      });
    }
    
    // Find depot with active signal
    const depot = await Depot.findById(signalId);
    if (!depot) {
      return res.status(404).json({
        success: false,
        message: 'Depot not found'
      });
    }
    
    // Check if depot is in same county as KCC branch
    if (depot.location.county !== kccBranch.location.county) {
      return res.status(400).json({
        success: false,
        message: `This depot is in ${depot.location.county}, your branch serves ${kccBranch.location.county}`
      });
    }
    
    // Check signal status
    await depot.getPickupSignalStatus(); // Auto-expire if needed
    
    if (!depot.pickupSignal || depot.pickupSignal.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: 'Pickup signal no longer available',
        data: {
          currentStatus: depot.pickupSignal?.status || 'no signal'
        }
      });
    }
    
    // Check if KCC has any pending payments first
    const pendingPickups = await Transaction.find({
      kccAttendant: kccAttendantId,
      type: 'kcc_pickup',
      status: 'pending'
    });
    
    if (pendingPickups.length > 0) {
      const totalPendingLiters = pendingPickups.reduce((sum, tx) => sum + tx.litersRaw, 0);
      return res.status(400).json({
        success: false,
        message: 'Please complete payment for existing pickups first',
        data: {
          pendingPickups: pendingPickups.length,
          totalPendingLiters: totalPendingLiters,
          totalCost: totalPendingLiters
        }
      });
    }
    
    // ✅ FIX: Use ObjectId for comparison
    const kccAttendantIdObj = new mongoose.Types.ObjectId(kccAttendantId);
    
    // Accept the pickup signal
    depot.pickupSignal.status = 'accepted';
    depot.pickupSignal.acceptedBy = kccAttendantIdObj;
    await depot.save();
    
    // Get depot attendant info
    const depotAttendant = await User.findById(depot.assignedAttendant).select('name phone');
    
    res.json({
      success: true,
      message: `Pickup accepted for ${depot.name}`,
      data: {
        acceptance: {
          signalId: depot._id,
          depot: {
            name: depot.name,
            code: depot.code,
            location: depot.location,
            attendant: depotAttendant
          },
          estimatedLiters: depot.pickupSignal.estimatedLiters,
          acceptedAt: new Date(),
          kccAttendant: {
            name: kccAttendant.name,
            phone: kccAttendant.phone
          },
          instructions: [
            `Proceed to ${depot.name} within 2 hours`,
            `Contact depot attendant: ${depotAttendant?.name || 'N/A'} (${depotAttendant?.phone || 'N/A'})`,
            `Measure milk quantity physically upon arrival`,
            `Use "Record Pickup" in app after measurement`
          ]
        }
      }
    });
    
  } catch (error) {
    console.error('Accept pickup error:', error);
    
    res.status(400).json({
      success: false,
      message: 'Failed to accept pickup',
      error: error.message
    });
  }
}

/**
 * Get accepted pickup for current KCC attendant
 * GET /kcc/pickups/accepted
 */
static async getAcceptedPickup(req, res) {
  try {
    const kccAttendantId = req.user.id;
    
    const depot = await Depot.findAcceptedPickupByKccAttendant(kccAttendantId);
    
    if (!depot) {
      return res.json({
        success: true,
        message: 'No accepted pickup found',
        data: { acceptedPickup: null }
      });
    }
    
    // Get depot attendant info
    const depotAttendant = await User.findById(depot.assignedAttendant).select('name phone');
    
    res.json({
      success: true,
      message: `You have an accepted pickup at ${depot.name}`,
      data: {
        acceptedPickup: {
          signalId: depot._id,
          depot: {
            name: depot.name,
            code: depot.code,
            location: depot.location,
            attendant: depotAttendant
          },
          signal: depot.pickupSignal,
          timeRemaining: Math.round((depot.pickupSignal.expiresAt - new Date()) / 60000) + ' minutes'
        }
      }
    });
    
  } catch (error) {
    console.error('Get accepted pickup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get accepted pickup',
      error: error.message
    });
  }
}

/**
 * Complete pickup signal after collection (optional - can be auto-cleared)
 * POST /kcc/pickup-signals/:signalId/complete
 */
static async completePickupSignal(req, res) {
  try {
    const { signalId } = req.params;
    const kccAttendantId = req.user.id;
    
    const depot = await Depot.findById(signalId);
    if (!depot) {
      return res.status(404).json({
        success: false,
        message: 'Depot not found'
      });
    }
    
    // Verify this KCC attendant accepted this signal
    if (!depot.pickupSignal || 
        depot.pickupSignal.status !== 'accepted' || 
        depot.pickupSignal.acceptedBy.toString() !== kccAttendantId) {
      return res.status(403).json({
        success: false,
        message: 'You have not accepted this pickup signal'
      });
    }
    
    // Complete the signal
    await depot.completePickupSignal();
    
    res.json({
      success: true,
      message: 'Pickup signal marked as completed',
      data: {
        completedAt: new Date(),
        depot: depot.name,
        signalId: depot._id
      }
    });
    
  } catch (error) {
    console.error('Complete pickup error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to complete pickup signal',
      error: error.message
    });
  }
}

/**
 * Release pickup signal if KCC attendant cannot fulfill (cancel acceptance)
 * DELETE /kcc/pickup-signals/:signalId/release
 */
static async releasePickupSignal(req, res) {
  try {
    const { signalId } = req.params;
    const kccAttendantId = req.user.id;
    
    const depot = await Depot.findById(signalId);
    if (!depot) {
      return res.status(404).json({
        success: false,
        message: 'Depot not found'
      });
    }
    
    // Verify this KCC attendant accepted this signal
    if (!depot.pickupSignal || 
        depot.pickupSignal.status !== 'accepted' || 
        depot.pickupSignal.acceptedBy.toString() !== kccAttendantId) {
      return res.status(403).json({
        success: false,
        message: 'You have not accepted this pickup signal'
      });
    }
    
    // Release the signal (set back to available)
    depot.pickupSignal.status = 'available';
    depot.pickupSignal.acceptedBy = null;
    await depot.save();
    
    res.json({
      success: true,
      message: 'Pickup signal released',
      data: {
        releasedAt: new Date(),
        depot: depot.name,
        note: 'This pickup is now available for other KCC attendants'
      }
    });
    
  } catch (error) {
    console.error('Release pickup error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to release pickup signal',
      error: error.message
    });
  }
}  
  /**
   * Get KCC branch details and attendants
   */
  static async getKccDetails(req, res) {
    try {
      const kccAdminId = req.user.id;
      
      // Verify requester is KCC admin
      const kccAdmin = await User.findById(kccAdminId);
      if (!kccAdmin.isKccAdmin()) {
        return res.status(403).json({
          success: false,
          message: 'Only KCC admins can access branch details'
        });
      }
      
      const [kccBranch, attendants] = await Promise.all([
        Kcc.findById(kccAdmin.assignedKcc),
        User.findKccAttendantsByBranch(kccAdmin.assignedKcc)
      ]);
      
      if (!kccBranch) {
        return res.status(404).json({
          success: false,
          message: 'KCC branch not found'
        });
      }
      
      // Get wallet balances for attendants
      const attendantsWithBalances = await Promise.all(
        attendants.map(async (attendant) => {
          const wallet = await Wallet.getOrCreateWallet(attendant._id);
          return {
            id: attendant._id,
            name: attendant.name,
            phone: attendant.phone,
            email: attendant.email,
            balance: wallet.getBalance(),
            status: attendant.status
          };
        })
      );
      
      res.json({
        success: true,
        message: 'KCC details retrieved',
        data: {
          kccBranch: {
            id: kccBranch._id,
            name: kccBranch.name,
            code: kccBranch.code,
            location: kccBranch.location,
            contact: kccBranch.contact,
            status: kccBranch.status
          },
          attendants: attendantsWithBalances
        }
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get KCC details',
        error: error.message
      });
    }
  }
  
  /**
   * Get all KCC branches (Admin only)
   */
  static async getAllKccBranches(req, res) {
    try {
      const kccBranches = await Kcc.findActiveBranches();
      
      res.json({
        success: true,
        message: 'KCC branches retrieved',
        data: {
          branches: kccBranches,
          count: kccBranches.length
        }
      });
      
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get KCC branches',
        error: error.message
      });
    }
  }
}

export default KccController;