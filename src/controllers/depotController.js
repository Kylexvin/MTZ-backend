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
    const depositCode = await this.generateDepositCode(depot.code);
    const shortCode = this.generateShortCode();

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

// ✅ HELPER FUNCTIONS - Added as static methods

/**
 * Generate depot-specific sequential deposit code (KMB001-0025)
 */
static async generateDepositCode(depotCode) {
  const Transaction = mongoose.model('Transaction');
  
  // Find the last deposit for this depot to get next sequence
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
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No confusing characters (0,O,1,I)
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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
      const tokensDue = Token.calculateMintAmount(deposit.litersRaw, deposit.qualityGrade);
      return {
        transactionId: deposit._id,
        reference: deposit.reference,
        depositCode: deposit.depositCode,  // ✅ Added
        shortCode: deposit.shortCode,      // ✅ Added
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
 * Process token payment for pending milk deposit - STEP 2
 */
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


  /**
   * Get depot dashboard
   */
  static async getDashboard(req, res) {
    try {
      const depot = await Depot.findById(req.params.depotId)
        .populate('assignedAttendant', 'name phone tokenBalance');

      if (!depot) {
        return res.status(404).json({
          success: false,
          message: 'Depot not found'
        });
      }

      // Get today's transactions
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const todayTransactions = await Transaction.find({
        depot: depot._id,
        createdAt: { $gte: todayStart },
        status: 'completed'
      }).sort({ createdAt: -1 }).limit(10);

      const dashboard = {
        depot: {
          name: depot.name,
          code: depot.code,
          location: depot.location,
          status: depot.status
        },
        stock: {
          rawMilk: depot.stock.rawMilk,
          pasteurizedMilk: depot.stock.pasteurizedMilk,
          capacity: depot.stock.capacity
        },
        todayActivity: {
          deposits: todayTransactions.filter(tx => tx.type === 'milk_deposit').length,
          withdrawals: todayTransactions.filter(tx => tx.type === 'milk_withdrawal').length,
          pickups: todayTransactions.filter(tx => tx.type === 'kcc_pickup').length,
          deliveries: todayTransactions.filter(tx => tx.type === 'kcc_delivery').length
        },
        recentTransactions: todayTransactions
      };

      res.json({
        success: true,
        message: 'Dashboard retrieved',
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
}

export default DepotController;