// src/controllers/depotController.js
import mongoose from 'mongoose';
import Depot from '../models/Depot.js';
import User from '../models/User.js';
import Transaction from '../models/Transaction.js';
import Token from '../models/Token.js';

class DepotController {

/**
 * Create new depot (Admin only)
 */
static async createDepot(req, res) {
  try {
    const { 
      name, 
      code, 
      location, 
      capacity, 
      attendantId,
      pricing 
    } = req.body;

    // Check if code already exists
    const existingDepot = await Depot.findOne({ code: code.toUpperCase() });
    if (existingDepot) {
      return res.status(400).json({
        success: false,
        message: 'Depot code already exists'
      });
    }

    let attendant = null;
    
    // If attendantId is provided, validate the attendant
    if (attendantId) {
      attendant = await User.findById(attendantId);
      if (!attendant || attendant.role !== 'attendant') {
        return res.status(400).json({
          success: false,
          message: 'Invalid attendant'
        });
      }

      // Check if attendant already assigned to another depot
      if (attendant.assignedDepot) {
        return res.status(400).json({
          success: false,
          message: 'Attendant already assigned to another depot'
        });
      }
    }

    // Create depot
    const depot = await Depot.create({
      name,
      code: code.toUpperCase(),
      location,
      stock: {
        rawMilk: 0,
        pasteurizedMilk: 0,
        capacity: capacity || 1000
      },
      pricing: pricing || {
        baseRate: 1.0,
        premiumRate: 1.2
      },
      assignedAttendant: attendantId || null,
      status: 'active'
    });

    // If attendant was provided, assign depot to attendant
    if (attendant) {
      attendant.assignedDepot = depot._id;
      await attendant.save();
    }

    // Prepare response data
    const responseData = {
      id: depot._id,
      name: depot.name,
      code: depot.code,
      location: depot.location,
      capacity: depot.stock.capacity,
      status: depot.status
    };

    // Add attendant info if available
    if (attendant) {
      responseData.attendant = {
        id: attendant._id,
        name: attendant.name,
        phone: attendant.phone
      };
    }

    res.status(201).json({
      success: true,
      message: attendant ? 'Depot created successfully with attendant' : 'Depot created successfully',
      data: {
        depot: responseData
      }
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Depot creation failed',
      error: error.message
    });
  }
}
/**
 * Get all depots
 */
static async getAllDepots(req, res) {
  try {
    const { county, status } = req.query;
    
    const filter = {};
    if (county) filter['location.county'] = county;
    if (status) filter.status = status;

    const depots = await Depot.find(filter)
      .populate('assignedAttendant', 'name phone email tokenBalance')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      message: 'Depots retrieved',
      data: {
        count: depots.length,
        depots
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve depots',
      error: error.message
    });
  }
}

/**
 * Get single depot
 */
static async getDepot(req, res) {
  try {
    const depot = await Depot.findById(req.params.id)
      .populate('assignedAttendant', 'name phone email tokenBalance');

    if (!depot) {
      return res.status(404).json({
        success: false,
        message: 'Depot not found'
      });
    }

    res.json({
      success: true,
      message: 'Depot retrieved',
      data: { depot }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve depot',
      error: error.message
    });
  }
}

/**
 * Update depot
 */
static async updateDepot(req, res) {
  try {
    const { name, location, capacity, pricing, status } = req.body;

    const depot = await Depot.findById(req.params.id);
    if (!depot) {
      return res.status(404).json({
        success: false,
        message: 'Depot not found'
      });
    }

    if (name) depot.name = name;
    if (location) depot.location = { ...depot.location, ...location };
    if (capacity) depot.stock.capacity = capacity;
    if (pricing) depot.pricing = { ...depot.pricing, ...pricing };
    if (status) depot.status = status;

    await depot.save();

    res.json({
      success: true,
      message: 'Depot updated successfully',
      data: { depot }
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Depot update failed',
      error: error.message
    });
  }
}

/**
 * Assign/Reassign attendant to depot
 */
static async assignAttendant(req, res) {
  try {
    const { attendantId } = req.body;
    const depotId = req.params.id;

    const depot = await Depot.findById(depotId);
    const newAttendant = await User.findById(attendantId);

    if (!depot || !newAttendant) {
      return res.status(404).json({
        success: false,
        message: 'Depot or attendant not found'
      });
    }

    if (newAttendant.role !== 'attendant') {
      return res.status(400).json({
        success: false,
        message: 'User is not an attendant'
      });
    }

    // Unassign old attendant if exists
    if (depot.assignedAttendant) {
      const oldAttendant = await User.findById(depot.assignedAttendant);
      if (oldAttendant) {
        oldAttendant.assignedDepot = null;
        await oldAttendant.save();
      }
    }

    // Assign new attendant
    depot.assignedAttendant = attendantId;
    await depot.save();

    newAttendant.assignedDepot = depotId;
    await newAttendant.save();

    res.json({
      success: true,
      message: 'Attendant assigned successfully',
      data: {
        depot: {
          id: depot._id,
          name: depot.name,
          code: depot.code
        },
        attendant: {
          id: newAttendant._id,
          name: newAttendant.name,
          phone: newAttendant.phone
        }
      }
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Attendant assignment failed',
      error: error.message
    });
  }
}

  /**
   * Find farmer by phone (for attendants at specific depot)
   */
  static async findFarmerByPhone(req, res) {
    try {
      const { phone } = req.query;
      const attendantId = req.user.id;
      
      // Verify attendant is assigned to this depot
      const attendant = await User.findById(attendantId);
      if (!attendant.assignedDepot) {
        return res.status(403).json({
          success: false,
          message: 'Attendant not assigned to any depot'
        });
      }

      const farmer = await User.findOne({ 
        phone: phone, 
        role: 'farmer' 
      }).select('name phone county status');

      if (!farmer) {
        return res.status(404).json({
          success: false,
          message: 'Farmer not found with this phone number'
        });
      }

      res.json({
        success: true,
        message: 'Farmer found',
        data: {
          farmer: {
            id: farmer._id,
            name: farmer.name,
            phone: farmer.phone,
            county: farmer.county,
            status: farmer.status
          }
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Farmer lookup failed',
        error: error.message
      });
    }
  }
// Helper functions for generating codes (inside class as static methods)
/**
 * Generate depot-specific sequential deposit code (KMB001-0025)
 */
static async generateDepositCode(depotCode) {
  const Transaction = mongoose.model('Transaction');
  
  const lastDeposit = await Transaction.findOne(
    { depot: { $exists: true }, depositCode: new RegExp(`^${depotCode}-`) },
    { depositCode: 1 },
    { sort: { createdAt: -1 } }
  );
  
  let sequence = 1;
  if (lastDeposit && lastDeposit.depositCode) {
    const lastSequence = parseInt(lastDeposit.depositCode.split('-')[1]) || 0;
    sequence = lastSequence + 1;
  }
  
  return `${depotCode}-${sequence.toString().padStart(4, '0')}`;
}

/**
 * Generate 6-digit easy-to-remember short code
 */
static generateShortCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Record milk deposit only (physical milk acceptance) - STEP 1
 */
static async recordMilkDeposit(req, res) {
  try {
    const { farmerPhone, liters, lactometerReading } = req.body;
    const attendantId = req.user.id;
    const depotId = req.params.depotId;

    // Verify attendant is assigned to THIS specific depot
    const attendant = await User.findById(attendantId);
    if (!attendant.assignedDepot || attendant.assignedDepot.toString() !== depotId) {
      return res.status(403).json({
        success: false,
        message: 'Attendant not authorized for this depot'
      });
    }

    // Find farmer by phone
    const farmer = await User.findOne({ phone: farmerPhone, role: 'farmer' });
    if (!farmer) {
      return res.status(404).json({
        success: false,
        message: 'Farmer not found with this phone number'
      });
    }

    // Check if farmer account is active
    if (farmer.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Farmer account is ${farmer.status} - cannot accept deposits`
      });
    }

    const depot = await Depot.findById(depotId);

    // Verify depot exists and is active
    if (!depot) {
      return res.status(404).json({
        success: false,
        message: 'Depot not found'
      });
    }

    if (depot.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Depot is ${depot.status} - cannot accept deposits`
      });
    }

    // ✅ REMOVED: All token calculations - just record milk quality
    const quality = lactometerReading >= 28 ? 'premium' : 'standard';

    // Check depot capacity
    if (!depot.canAcceptDeposit(liters)) {
      return res.status(400).json({
        success: false,
        message: `Depot cannot accept ${liters}L. Current: ${depot.stock.rawMilk}L/${depot.stock.capacity}L`
      });
    }

    // ✅ GENERATE farmer-friendly codes
    // FIXED: Call using the class name
    const depositCode = await DepotController.generateDepositCode(depot.code);
    const shortCode = DepotController.generateShortCode();

    // Create PENDING milk deposit transaction (NO token amounts)
    const transaction = await Transaction.create({
      type: 'milk_deposit',
      fromUser: farmer._id,
      toUser: farmer._id,
      attendant: attendantId,
      depot: depot._id,
      litersRaw: liters,
      lactometerReading: lactometerReading,
      qualityGrade: quality,
      tokensAmount: 0, // ✅ Will be calculated during payment
      status: 'pending', // Waiting for token payment
      depositCode: depositCode, // ✅ Added: Depot-specific sequential code
      shortCode: shortCode,     // ✅ Added: 6-digit easy code
      notes: `Milk deposit recorded at ${depot.name} - awaiting token payment. Codes: ${depositCode}, ${shortCode}`
    });

    // Update depot stock immediately (milk is physically deposited)
    await depot.addMilkStock(liters, 'raw');

    res.json({
      success: true,
      message: `${liters}L milk deposited successfully at ${depot.name}`,
      data: {
        depositRecord: {
          depositCode: depositCode,      // ✅ Added: KMB001-0025
          shortCode: shortCode,          // ✅ Added: A3B7X9
          reference: transaction.reference, // Existing reference
          transactionId: transaction._id, // Keep for internal reference
          farmer: {
            name: farmer.name,
            phone: farmer.phone
          },
          liters,
          quality,
          depot: {
            name: depot.name,
            code: depot.code
          },
          depotStock: {
            rawMilk: depot.stock.rawMilk,
            capacity: depot.stock.capacity
          },
          status: 'pending_payment',
          depositTime: transaction.createdAt,
          nextStep: 'Present this code at counter for token payment' // ✅ Updated message
        }
      }
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Milk deposit recording failed',
      error: error.message
    });
  }
}

/**
 * Get pending deposits for specific depot
 */
static async getPendingDeposits(req, res) {
  try {
    const depotId = req.params.depotId;
    const attendantId = req.user.id;

    // Verify attendant is assigned to this depot
    const attendant = await User.findById(attendantId);
    if (!attendant.assignedDepot || attendant.assignedDepot.toString() !== depotId) {
      return res.status(403).json({
        success: false,
        message: 'Attendant not authorized for this depot'
      });
    }

    const pendingDeposits = await Transaction.find({
      depot: depotId,
      type: 'milk_deposit',
      status: 'pending'
    })
    .populate('fromUser', 'name phone')
    .sort({ createdAt: -1 });

    // ✅ Calculate tokens due for each pending deposit
    const depositsWithTokens = pendingDeposits.map(deposit => {
      const tokensDue = deposit.litersRaw; // 1 liter = 1 MTZ
      return {
        transactionId: deposit._id,
        reference: deposit.reference,
        depositCode: deposit.depositCode,
        shortCode: deposit.shortCode,
        farmer: {
          name: deposit.fromUser.name,
          phone: deposit.fromUser.phone
        },
        liters: deposit.litersRaw,
        quality: deposit.qualityGrade,
        lactometerReading: deposit.lactometerReading,
        tokensDue: tokensDue,
        depositTime: deposit.createdAt
      };
    });

    res.json({
      success: true,
      message: 'Pending deposits retrieved',
      data: {
        count: pendingDeposits.length,
        pendingDeposits: depositsWithTokens
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve pending deposits',
      error: error.message
    });
  }
}

/**
 * Process token payment for pending milk deposit - SIMPLE SETTLEMENT
 */
static async processTokenPayment(req, res) {
  try {
    const { transactionId } = req.body;
    const attendantId = req.user.id;
    const depotId = req.params.depotId;

    // Verify attendant is assigned to this depot
    const attendant = await User.findById(attendantId);
    if (!attendant.assignedDepot || attendant.assignedDepot.toString() !== depotId) {
      return res.status(403).json({
        success: false,
        message: 'Attendant not authorized for this depot'
      });
    }

    const Wallet = mongoose.model('Wallet');
    
    // Find the pending deposit transaction for THIS depot
    const depositTx = await Transaction.findOne({
      _id: transactionId,
      depot: depotId,
      type: 'milk_deposit',
      status: 'pending'
    }).populate('fromUser toUser depot');

    if (!depositTx) {
      return res.status(404).json({
        success: false,
        message: 'Pending deposit transaction not found in this depot'
      });
    }

    const farmer = depositTx.fromUser;
    const liters = depositTx.litersRaw;
    const quality = depositTx.qualityGrade;

    // Calculate tokens due (1 liter = 1 token)
    const tokensAmount = liters;

    // Check attendant has enough tokens in their wallet
    const attendantWallet = await Wallet.getOrCreateWallet(attendantId);
    if (attendantWallet.getBalance() < tokensAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient tokens. Available: ${attendantWallet.getBalance()} MTZ, Needed: ${tokensAmount} MTZ`
      });
    }

    // ✅ SIMPLE: Transfer tokens from attendant to farmer
    const transferResult = await Wallet.transferTokens(
      attendantId,     // FROM attendant (has 10,000 MTZ)
      farmer._id,      // TO farmer  
      tokensAmount,
      `Payment for ${liters}L ${quality} milk at ${depositTx.depot.name}`
    );

    // ✅ UPDATE the milk deposit transaction to completed
    depositTx.tokensAmount = tokensAmount;
    depositTx.status = 'completed';
    depositTx.notes = `Token payment completed - ${tokensAmount} MTZ paid`;
    await depositTx.save();

    res.json({
      success: true,
      message: `${tokensAmount} MTZ paid to ${farmer.name} for ${liters}L ${quality} milk`,
      data: {
        paymentReceipt: {
          transactionId: depositTx.reference,
          farmer: {
            name: farmer.name,
            phone: farmer.phone
          },
          milkDetails: {
            liters: liters,
            quality: quality,
            lactometerReading: depositTx.lactometerReading
          },
          paymentDetails: {
            tokensPaid: tokensAmount,
            rate: '1 MTZ per liter',
            attendantBalance: transferResult.fromBalance,  // New balance: 10,000 - 25 = 9,975
            farmerBalance: transferResult.toBalance        // New balance: 0 + 25 = 25
          },
          depot: depositTx.depot.name,
          status: 'completed',
          paymentTime: new Date()
        }
      }
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      message: 'Token payment failed',
      error: error.message
    });
  }
}

/**
 * Get all transactions for specific depot with filters
 */
static async getDepotTransactions(req, res) {
  try {
    const depotId = req.params.depotId;
    const attendantId = req.user.id;
    const { 
      type, 
      status, 
      startDate, 
      endDate,
      page = 1,
      limit = 20 
    } = req.query;

    // Verify attendant is assigned to this depot
    const attendant = await User.findById(attendantId);
    if (!attendant.assignedDepot || attendant.assignedDepot.toString() !== depotId) {
      return res.status(403).json({
        success: false,
        message: 'Attendant not authorized for this depot'
      });
    }

    // Build filter
    const filter = { depot: depotId };
    if (type) filter.type = type; // 'milk_deposit', 'kcc_pickup', 'kcc_delivery'
    if (status) filter.status = status; // 'pending', 'completed', 'failed'
    
    // Date filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('fromUser', 'name phone')
        .populate('toUser', 'name phone')
        .populate('kccAttendant', 'name phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Transaction.countDocuments(filter)
    ]);

    const formattedTransactions = transactions.map(tx => ({
      id: tx._id,
      reference: tx.reference,
      type: tx.type,
      status: tx.status,
      fromUser: tx.fromUser,
      toUser: tx.toUser,
      kccAttendant: tx.kccAttendant,
      litersRaw: tx.litersRaw,
      litersPasteurized: tx.litersPasteurized,
      tokensAmount: tx.tokensAmount,
      qualityGrade: tx.qualityGrade,
      lactometerReading: tx.lactometerReading,
      depositCode: tx.depositCode,
      shortCode: tx.shortCode,
      notes: tx.notes,
      createdAt: tx.createdAt,
      updatedAt: tx.updatedAt
    }));

    res.json({
      success: true,
      message: 'Transactions retrieved',
      data: {
        transactions: formattedTransactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve transactions',
      error: error.message
    });
  }
}
  /**
   * Get depot dashboard for specific depot
   */
  static async getDepotDashboard(req, res) {
    try {
      const depotId = req.params.depotId;
      const attendantId = req.user.id;

      // Verify attendant is assigned to this depot
      const attendant = await User.findById(attendantId);
      if (!attendant.assignedDepot || attendant.assignedDepot.toString() !== depotId) {
        return res.status(403).json({
          success: false,
          message: 'Attendant not authorized for this depot'
        });
      }

      const [depot, pendingDeposits, Wallet] = await Promise.all([
        Depot.findById(depotId).populate('assignedAttendant', 'name phone'),
        Transaction.find({
          depot: depotId,
          type: 'milk_deposit',
          status: 'pending'
        }).countDocuments(),
        mongoose.model('Wallet')
      ]);

      if (!depot) {
        return res.status(404).json({
          success: false,
          message: 'Depot not found'
        });
      }

      // Get attendant's wallet balance
      const attendantWallet = await Wallet.getOrCreateWallet(attendantId);

      const dashboard = {
        depot: {
          name: depot.name,
          code: depot.code,
          location: depot.location,
          status: depot.status,
          attendant: depot.assignedAttendant
        },
        stock: {
          rawMilk: depot.stock.rawMilk,
          pasteurizedMilk: depot.stock.pasteurizedMilk,
          capacity: depot.stock.capacity,
          utilization: ((depot.stock.rawMilk + depot.stock.pasteurizedMilk) / depot.stock.capacity * 100).toFixed(1)
        },
        operations: {
          pendingDeposits: pendingDeposits,
          needsPickup: depot.needsKccPickup()
        },
        attendant: {
          walletBalance: attendantWallet.getBalance(),
          dailyLimit: attendantWallet.limits.dailySendLimit,
          dailyUsed: attendantWallet.limits.dailySendUsed
        }
      };

      res.json({
        success: true,
        message: `Dashboard for ${depot.name}`,
        data: dashboard
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to load depot dashboard',
        error: error.message
      });
    }
  }


  /**
   * KCC picks up raw milk - replenishes tokens to depot attendant
   */
  static async kccPickup(req, res) {
    try {
      const { litersRaw } = req.body;
      const attendantId = req.user.id;

      const depot = await Depot.findById(req.params.depotId);
      const attendant = await User.findById(attendantId);

      if (!depot) {
        return res.status(404).json({
          success: false,
          message: 'Depot not found'
        });
      }

      // Verify exact amount available
      if (depot.stock.rawMilk < litersRaw) {
        return res.status(400).json({
          success: false,
          message: `Only ${depot.stock.rawMilk}L available, requested ${litersRaw}L`
        });
      }

      // Create pickup transaction
      const transaction = new Transaction({
        type: 'kcc_pickup',
        fromUser: attendantId,
        toUser: attendantId, // Tokens to depot attendant
        attendant: attendantId,
        depot: depot._id,
        litersRaw: litersRaw,
        tokensAmount: litersRaw, // 1:1 token replenishment
        status: 'completed'
      });

      await transaction.save();

      // Remove milk from depot
      await depot.removeMilkStock(litersRaw, 'raw');
      
      // Replenish tokens to attendant
      await attendant.updateTokenBalance(litersRaw, 'add');

      res.json({
        success: true,
        message: `${litersRaw}L collected - ${litersRaw} tokens replenished`,
        data: {
          receipt: {
            transactionId: transaction.reference,
            litersCollected: litersRaw,
            tokensReplenished: litersRaw,
            attendantBalance: attendant.tokenBalance,
            depotStock: {
              rawMilk: depot.stock.rawMilk,
              pasteurizedMilk: depot.stock.pasteurizedMilk
            }
          }
        }
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Pickup failed',
        error: error.message
      });
    }
  }

  /**
   * KCC delivers pasteurized milk - depot attendant pays tokens
   */
  static async kccDelivery(req, res) {
    try {
      const { litersPasteurized, kccAttendantId } = req.body;
      const attendantId = req.user.id;

      const depot = await Depot.findById(req.params.depotId);
      const attendant = await User.findById(attendantId);
      const kccAttendant = await User.findById(kccAttendantId);

      if (!depot || !kccAttendant) {
        return res.status(404).json({
          success: false,
          message: 'Depot or KCC attendant not found'
        });
      }

      // Verify attendant has enough tokens
      if (attendant.tokenBalance < litersPasteurized) {
        return res.status(400).json({
          success: false,
          message: `Insufficient tokens. Available: ${attendant.tokenBalance}, Required: ${litersPasteurized}`
        });
      }

      // Create delivery transaction
      const transaction = new Transaction({
        type: 'kcc_delivery',
        fromUser: attendantId, // Depot attendant pays
        toUser: kccAttendantId, // KCC attendant receives
        attendant: attendantId,
        kccAttendant: kccAttendantId,
        depot: depot._id,
        litersPasteurized: litersPasteurized,
        tokensAmount: litersPasteurized, // 1:1 token payment
        status: 'completed'
      });

      await transaction.save();

      // Add milk to depot
      await depot.addMilkStock(litersPasteurized, 'pasteurized');
      
      // Transfer tokens from attendant to KCC
      await attendant.updateTokenBalance(litersPasteurized, 'subtract');
      await kccAttendant.updateTokenBalance(litersPasteurized, 'add');

      res.json({
        success: true,
        message: `${litersPasteurized}L delivered - ${litersPasteurized} tokens paid`,
        data: {
          receipt: {
            transactionId: transaction.reference,
            litersDelivered: litersPasteurized,
            tokensPaid: litersPasteurized,
            attendantBalance: attendant.tokenBalance,
            kccBalance: kccAttendant.tokenBalance,
            depotStock: {
              rawMilk: depot.stock.rawMilk,
              pasteurizedMilk: depot.stock.pasteurizedMilk
            }
          }
        }
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Delivery failed',
        error: error.message
      });
    }
  }

static async getDashboard(req, res) {
  try {
    // Use the depot from middleware instead of params
    const depot = req.depot; // Already verified by requireAssignedDepot()
    
    // Count pending milk deposits for this depot
    const pendingDeposits = await Transaction.countDocuments({
      depot: depot._id,
      type: 'milk_deposit',
      status: 'pending'
    });

    // Check if KCC pickup is needed using depot method
    const needsPickup = depot.needsKccPickup();

    // Calculate utilization percentage
    const totalStock = depot.stock.rawMilk + depot.stock.pasteurizedMilk;
    const utilization = Math.round((totalStock / depot.stock.capacity) * 100);

    const dashboard = {
      stock: {
        rawMilk: depot.stock.rawMilk,
        pasteurizedMilk: depot.stock.pasteurizedMilk,
        capacity: depot.stock.capacity,
        utilization: utilization
      },
      operations: {
        pendingDeposits: pendingDeposits,
        needsPickup: needsPickup
      },
      depot: {
        name: depot.name,
        location: depot.location.county,
        status: depot.status
      }
    };

    res.json({
      success: true,
      data: dashboard
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to load dashboard',
      error: error.message
    });
  }
}

/**
 * Get today's summary stats for depot
 */
static async getTodayStats(req, res) {
  try {
    const depot = req.depot; // From requireAssignedDepot middleware
    
    // Get start of today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    // Get today's completed milk deposits
    const todayDeposits = await Transaction.find({
      depot: depot._id,
      type: 'milk_deposit',
      status: 'completed',
      createdAt: { $gte: todayStart }
    }).populate('fromUser', 'name phone');
    
    // Calculate stats
    const milkReceived = todayDeposits.reduce((sum, tx) => sum + (tx.litersRaw || 0), 0);
    
    // Count unique farmers
    const farmerIds = new Set(todayDeposits.map(tx => tx.fromUser?._id?.toString()).filter(Boolean));
    const farmersCount = farmerIds.size;
    
    // Calculate tokens paid (assuming tokensAmount field)
    const tokensPaid = todayDeposits.reduce((sum, tx) => sum + (tx.tokensAmount || 0), 0);
    
    // Calculate average lactometer reading
    const lactometerReadings = todayDeposits.map(tx => tx.lactometerReading).filter(Boolean);
    const avgLactometer = lactometerReadings.length > 0 
      ? (lactometerReadings.reduce((a, b) => a + b, 0) / lactometerReadings.length).toFixed(1)
      : 0;
    
    // Determine quality grade
    const avgQuality = avgLactometer >= 28 ? 'Premium' : 
                      avgLactometer >= 25 ? 'Standard' : 'Low';
    
    res.json({
      success: true,
      data: {
        milkReceived,
        farmersCount,
        tokensPaid,
        avgQuality: avgLactometer > 0 ? avgQuality : 'N/A'
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to load today\'s stats',
      error: error.message
    });
  }
} 

// Add these methods to your DepotController class

/**
 * 1. GET Current Stock Levels (Simplified for Inventory screen)
 * Endpoint: GET /depots/:depotId/inventory
 */
static async getInventoryData(req, res) {
  try {
    const depot = req.depot; // From middleware
    const attendantId = req.user.id;

    // Calculate utilization percentage
    const totalStock = depot.stock.rawMilk + depot.stock.pasteurizedMilk;
    const utilization = Math.round((totalStock / depot.stock.capacity) * 100);

    const inventoryData = {
      stock: {
        rawMilk: depot.stock.rawMilk,
        pasteurizedMilk: depot.stock.pasteurizedMilk,
        capacity: depot.stock.capacity,
        utilization: utilization,
        lastUpdated: depot.updatedAt
      },
      depot: {
        name: depot.name,
        code: depot.code,
        location: depot.location
      }
    };

    res.json({
      success: true,
      message: 'Inventory data retrieved',
      data: inventoryData
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve inventory data',
      error: error.message
    });
  }
}

/**
 * 2. GET Recent KCC Operations
 * Endpoint: GET /depots/:depotId/operations/recent?limit=5
 */
static async getRecentKccOperations(req, res) {
  try {
    const depot = req.depot;
    const limit = parseInt(req.query.limit) || 5;
    
    const formattedRecentOps = recentOperations.map(op => {
  const isPickup = op.type === 'kcc_pickup';
  let displayTime = 'Recently';
  
  if (op.createdAt && op.createdAt instanceof Date) {
    const date = new Date(op.createdAt);
    const now = new Date();
    
    // Reset times to compare just dates
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const transactionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    const timeString = date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    
    if (transactionDate.getTime() === today.getTime()) {
      displayTime = `Today, ${timeString}`;
    } else {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      
      if (transactionDate.getTime() === yesterday.getTime()) {
        displayTime = `Yesterday, ${timeString}`;
      } else {
        const diffDays = Math.floor((today - transactionDate) / (1000 * 60 * 60 * 24));
        
        if (diffDays < 7) {
          const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const dayName = daysOfWeek[date.getDay()];
          displayTime = `${dayName}, ${timeString}`;
        } else {
          displayTime = date.toLocaleDateString('en-US', { 
            month: 'short',
            day: 'numeric'
          });
        }
      }
    }
  }
  
  return {
    id: op._id?.toString() || `op_${Date.now()}`,
    type: isPickup ? 'pickup' : 'delivery',
    liters: isPickup ? (op.litersRaw || 0) : (op.litersPasteurized || 0),
    time: displayTime,
    status: op.status || 'completed'
  };
}); 

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve KCC operations',
      error: error.message
    });
  }
}

/**
 * 3. GET Pending KCC Operations (for scheduled/pending)
 * Endpoint: GET /depots/:depotId/operations/pending
 */
static async getPendingKccOperations(req, res) {
  try {
    const depot = req.depot;
    
    // Check for pending delivery requests
    const pendingDeliveries = await DeliveryRequest.find({
      depot: depot._id,
      status: 'pending',
      expiresAt: { $gt: new Date() }
    })
    .populate('assignedKcc', 'name code')
    .sort({ createdAt: -1 })
    .lean();

    // Format as pending operations
    const pendingOperations = pendingDeliveries.map(delivery => ({
      id: delivery._id,
      type: 'delivery',
      liters: delivery.litersRequested,
      time: 'Scheduled',
      status: 'pending',
      kccBranch: delivery.assignedKcc ? {
        name: delivery.assignedKcc.name,
        code: delivery.assignedKcc.code
      } : null,
      qrCode: delivery.qrCode
    }));

    res.json({
      success: true,
      message: 'Pending KCC operations retrieved',
      data: {
        pendingOperations: pendingOperations
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve pending operations',
      error: error.message
    });
  }
}

/**
 * 4. GET Stock Alerts
 * Endpoint: GET /depots/:depotId/alerts
 */
static async getStockAlerts(req, res) {
  try {
    const depot = req.depot;
    const alerts = [];

    // Check raw milk capacity
    const rawMilkPercent = (depot.stock.rawMilk / depot.stock.capacity) * 100;
    
    if (rawMilkPercent >= 80) {
      alerts.push({
        id: 'capacity_warning',
        type: 'capacity_warning',
        severity: rawMilkPercent >= 90 ? 'high' : 'medium',
        title: 'Raw Milk Nearing Capacity',
        message: 'Consider scheduling KCC pickup soon',
        threshold: 80,
        current: Math.round(rawMilkPercent),
        metric: 'rawMilk',
        suggestedAction: 'Schedule KCC pickup',
        createdAt: new Date()
      });
    }

    // Check pasteurized milk stock (if too low)
    const pasteurizedPercent = (depot.stock.pasteurizedMilk / depot.stock.capacity) * 100;
    
    if (pasteurizedPercent <= 10 && depot.stock.pasteurizedMilk > 0) {
      alerts.push({
        id: 'low_pasteurized',
        type: 'low_stock',
        severity: 'medium',
        title: 'Low Pasteurized Milk Stock',
        message: 'Consider requesting KCC delivery',
        threshold: 10,
        current: Math.round(pasteurizedPercent),
        metric: 'pasteurizedMilk',
        suggestedAction: 'Request KCC delivery',
        createdAt: new Date()
      });
    }

    // Check if KCC pickup is needed based on depot rules
    if (depot.needsKccPickup()) {
      alerts.push({
        id: 'pickup_needed',
        type: 'pickup_required',
        severity: 'high',
        title: 'KCC Pickup Required',
        message: `Raw milk at ${Math.round(rawMilkPercent)}% capacity`,
        threshold: depot.pickupRules.triggerValue || 80,
        current: Math.round(rawMilkPercent),
        metric: 'rawMilk',
        suggestedAction: 'Request immediate pickup',
        createdAt: new Date()
      });
    }

    res.json({
      success: true,
      message: 'Stock alerts retrieved',
      data: {
        alerts: alerts,
        hasAlerts: alerts.length > 0
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve stock alerts',
      error: error.message
    });
  }
}


/**
 * 5. Combined Endpoint for Inventory Screen - FIXED VERSION
 * GET all data needed for the Inventory screen in one call
 * Endpoint: GET /depots/:depotId/inventory-screen
 */
static async getInventoryScreenData(req, res) {
  try {
    const depot = req.depot;
    
    // Get all data in parallel with better error handling
    const [
      inventoryData,
      recentOps,
      pendingOps,
      alerts
    ] = await Promise.allSettled([
      // 1. Stock data
      (async () => {
        const rawMilk = depot.stock?.rawMilk || 0;
        const pasteurizedMilk = depot.stock?.pasteurizedMilk || 0;
        const capacity = depot.stock?.capacity || 1;
        const totalStock = rawMilk + pasteurizedMilk;
        const utilization = Math.round((totalStock / capacity) * 100);
        
        return {
          rawMilk,
          pasteurizedMilk,
          capacity,
          utilization,
          lastUpdated: depot.updatedAt
        };
      })(),
      
      // 2. Recent operations (last 3 completed)
      Transaction.find({
        depot: depot._id,
        type: { $in: ['kcc_pickup', 'kcc_delivery'] },
        status: 'completed'
      })
      .sort({ createdAt: -1 })
      .limit(3)
      .populate('kccAttendant', 'name phone')
      .lean(),
      
      // 3. Pending operations (if DeliveryRequest model exists)
      (async () => {
        try {
          const DeliveryRequest = mongoose.model('DeliveryRequest');
          return await DeliveryRequest.find({
            depot: depot._id,
            status: 'pending',
            expiresAt: { $gt: new Date() }
          })
          .populate('assignedKcc', 'name code')
          .sort({ createdAt: -1 })
          .lean();
        } catch (error) {
          console.log('DeliveryRequest model not available, returning empty array');
          return [];
        }
      })(),
      
      // 4. Alerts
      (async () => {
        const alerts = [];
        const rawMilk = depot.stock?.rawMilk || 0;
        const capacity = depot.stock?.capacity || 1;
        const rawMilkPercent = (rawMilk / capacity) * 100;
        
        if (rawMilkPercent >= 80) {
          alerts.push({
            id: 'capacity_warning',
            type: 'capacity_warning',
            severity: rawMilkPercent >= 90 ? 'high' : 'medium',
            title: 'Raw Milk Nearing Capacity',
            message: 'Consider scheduling KCC pickup soon',
            current: Math.round(rawMilkPercent),
            metric: 'rawMilk',
            suggestedAction: 'Schedule KCC pickup',
            createdAt: new Date()
          });
        }
        
        // Check pasteurized milk stock (if too low)
        const pasteurizedMilk = depot.stock?.pasteurizedMilk || 0;
        const pasteurizedPercent = (pasteurizedMilk / capacity) * 100;
        
        if (pasteurizedPercent <= 10 && pasteurizedMilk > 0) {
          alerts.push({
            id: 'low_pasteurized',
            type: 'low_stock',
            severity: 'medium',
            title: 'Low Pasteurized Milk Stock',
            message: 'Consider requesting KCC delivery',
            current: Math.round(pasteurizedPercent),
            metric: 'pasteurizedMilk',
            suggestedAction: 'Request KCC delivery',
            createdAt: new Date()
          });
        }
        
        return alerts;
      })()
    ]);

    // Extract values from Promise.allSettled
    const stockData = inventoryData.status === 'fulfilled' ? inventoryData.value : {};
    const recentOperations = recentOps.status === 'fulfilled' ? recentOps.value : [];
    const pendingOperations = pendingOps.status === 'fulfilled' ? pendingOps.value : [];
    const stockAlerts = alerts.status === 'fulfilled' ? alerts.value : [];

    // Format recent operations with safe date handling
    const formattedRecentOps = recentOperations.map(op => {
      const isPickup = op.type === 'kcc_pickup';
      let displayTime = 'Recently';
      
      if (op.createdAt && op.createdAt instanceof Date) {
        const time = new Date(op.createdAt);
        const now = new Date();
        const diffHours = (now - time) / (1000 * 60 * 60);
        
        if (diffHours < 24) {
          displayTime = `Today, ${time.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}`;
        } else if (diffHours < 48) {
          displayTime = `Yesterday, ${time.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit' 
          })}`;
        } else if (diffHours < 168) { // Within a week
          const days = Math.floor(diffHours / 24);
          displayTime = `${days} days ago`;
        } else {
          displayTime = time.toLocaleDateString('en-US', { 
            month: 'short',
            day: 'numeric'
          });
        }
      }
      
      return {
        id: op._id?.toString() || `op_${Date.now()}`,
        type: isPickup ? 'pickup' : 'delivery',
        liters: isPickup ? (op.litersRaw || 0) : (op.litersPasteurized || 0),
        time: displayTime,
        status: op.status || 'completed'
      };
    });

    // Format pending operations
    const formattedPendingOps = pendingOperations.map(delivery => ({
      id: delivery._id?.toString() || `pending_${Date.now()}`,
      type: 'pickup',
      liters: delivery.litersRequested || 0,
      time: 'Scheduled',
      status: 'pending'
    }));

    // Combine all operations (recent + pending)
    const allOperations = [...formattedRecentOps, ...formattedPendingOps];

    const response = {
      stockData,
      kccOperations: allOperations,
      stockAlerts,
      depotInfo: {
        name: depot.name || 'Unknown Depot',
        code: depot.code || 'N/A',
        location: depot.location || {}
      }
    };

    res.json({
      success: true,
      message: 'Inventory screen data retrieved',
      data: response
    });

  } catch (error) {
    console.error('Error in getInventoryScreenData:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load inventory screen data',
      error: error.message,
      // Provide helpful debug info
      debug: {
        depotId: req.depot?._id,
        errorStack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });
  }
}

// Add these methods to your existing DepotController class

/**
 * Signal pickup availability (Depot attendant)
 * POST /depots/:depotId/pickup-signal
 */
static async signalPickupAvailable(req, res) {
  try {
    const { estimatedLiters } = req.body;
    const depot = req.depot; // From requireAssignedDepot middleware
    
    // Validate depot can create signal
    const validation = depot.canCreatePickupSignal();
    if (!validation.canCreate) {
      return res.status(400).json({
        success: false,
        message: validation.reason
      });
    }
    
    // Use estimatedLiters or current stock
    const litersToSignal = estimatedLiters || depot.stock.rawMilk;
    
    // Create pickup signal
    await depot.createPickupSignal(litersToSignal);
    
    // Refresh depot data
    const updatedDepot = await Depot.findById(depot._id);
    
    res.json({
      success: true,
      message: `Pickup signaled: ~${litersToSignal}L available`,
      data: {
        signal: {
          estimatedLiters: updatedDepot.pickupSignal.estimatedLiters,
          signaledAt: updatedDepot.pickupSignal.signaledAt,
          expiresAt: updatedDepot.pickupSignal.expiresAt,
          status: updatedDepot.pickupSignal.status,
          timeRemaining: Math.round((updatedDepot.pickupSignal.expiresAt - new Date()) / 60000) + ' minutes'
        },
        depot: {
          name: updatedDepot.name,
          stock: {
            rawMilk: updatedDepot.stock.rawMilk,
            capacity: updatedDepot.stock.capacity
          }
        }
      }
    });
    
  } catch (error) {
    console.error('Signal pickup error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to signal pickup',
      error: error.message
    });
  }
}

/**
 * Cancel pickup signal (Depot attendant)
 * DELETE /depots/:depotId/pickup-signal
 */
static async cancelPickupSignal(req, res) {
  try {
    const depot = req.depot;
    
    // Check if there's an active signal to cancel
    if (!depot.pickupSignal || depot.pickupSignal.status !== 'available') {
      return res.status(400).json({
        success: false,
        message: 'No active pickup signal to cancel'
      });
    }
    
    // Cancel the signal
    await depot.cancelPickupSignal();
    
    res.json({
      success: true,
      message: 'Pickup signal cancelled',
      data: {
        cancelledAt: new Date(),
        depot: {
          name: depot.name,
          code: depot.code
        }
      }
    });
    
  } catch (error) {
    console.error('Cancel pickup error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to cancel pickup signal',
      error: error.message
    });
  }
}

/**
 * Get current pickup signal status (Depot attendant)
 * GET /depots/:depotId/pickup-signal
 */
static async getPickupSignalStatus(req, res) {
  try {
    const depot = req.depot;
    
    // Get signal status (auto-expires if needed)
    const signal = await depot.getPickupSignalStatus();
    
    if (!signal || !signal.status) {
      return res.json({
        success: true,
        message: 'No active pickup signal',
        data: { 
          signal: null,
          depotStock: depot.stock.rawMilk
        }
      });
    }
    
    // Check if accepted by a KCC attendant
    let acceptedBy = null;
    if (signal.acceptedBy) {
      const kccAttendant = await User.findById(signal.acceptedBy).select('name phone');
      if (kccAttendant) {
        acceptedBy = {
          name: kccAttendant.name,
          phone: kccAttendant.phone
        };
      }
    }
    
    res.json({
      success: true,
      message: 'Pickup signal status retrieved',
      data: {
        signal: {
          estimatedLiters: signal.estimatedLiters,
          signaledAt: signal.signaledAt,
          expiresAt: signal.expiresAt,
          status: signal.status,
          timeRemaining: signal.expiresAt ? 
            Math.round((signal.expiresAt - new Date()) / 60000) + ' minutes' : null,
          acceptedBy: acceptedBy
        },
        depot: {
          name: depot.name,
          stock: {
            rawMilk: depot.stock.rawMilk,
            capacity: depot.stock.capacity
          }
        }
      }
    });
    
  } catch (error) {
    console.error('Get pickup signal error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get pickup signal status',
      error: error.message
    });
  }
}

/**
 * Clear pickup signal after KCC completes pickup (internal/auto)
 * This should be called after KCC attendant records pickup via existing recordKccPickup
 */
static async clearPickupSignalAfterPickup(req, res) {
  try {
    const { depotId } = req.params;
    
    const depot = await Depot.findById(depotId);
    if (!depot) {
      return res.status(404).json({
        success: false,
        message: 'Depot not found'
      });
    }
    
    // Clear the signal
    await depot.clearPickupSignal();
    
    res.json({
      success: true,
      message: 'Pickup signal cleared after collection',
      data: {
        clearedAt: new Date(),
        depot: depot.name
      }
    });
    
  } catch (error) {
    console.error('Clear pickup signal error:', error);
    res.status(400).json({
      success: false,
      message: 'Failed to clear pickup signal',
      error: error.message
    });
  }
}

}

export default DepotController;