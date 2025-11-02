import mongoose from 'mongoose';
import Transaction from '../models/Transaction.js';
import Wallet from '../models/Wallet.js';
import User from '../models/User.js'; 
import Depot from '../models/Depot.js'; 

class FarmerController {
  
  /**
   * Get farmer's milk deposit history with status summary
   */
  static async getFarmerDepositHistory(req, res) {
    try {
      const farmerId = req.user.id;
      const { status, limit = 50, page = 1 } = req.query;

      // Build query filter
      const filter = {
        fromUser: farmerId,
        type: 'milk_deposit'
      };

      // Filter by status if provided
      if (status && ['pending', 'completed', 'failed', 'cancelled'].includes(status)) {
        filter.status = status;
      }

      // Get deposits with pagination
      const deposits = await Transaction.find(filter)
        .populate('depot', 'name code location')
        .populate('attendant', 'name phone')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit));

      const total = await Transaction.countDocuments(filter);

      // Format response with farmer-friendly information
      const formattedDeposits = deposits.map(deposit => ({
        // Identification Codes
        depositId: deposit._id,
        depositCode: deposit.depositCode || null,
        shortCode: deposit.shortCode || null,
        reference: deposit.reference,
        
        // Deposit Details
        depot: {
          name: deposit.depot.name,
          code: deposit.depot.code,
          location: deposit.depot.location
        },
        liters: deposit.litersRaw,
        quality: deposit.qualityGrade,
        lactometerReading: deposit.lactometerReading,
        qualityDescription: deposit.lactometerReading >= 28 ? 'Premium Quality' : 'Standard Quality',
        
        // Token Information - SIMPLE 1:1 CALCULATION
        tokensExpected: deposit.litersRaw, // 1 liter = 1 token
        tokensReceived: deposit.status === 'completed' ? deposit.tokensAmount : 0,
        
        // Status & Timeline
        status: deposit.status,
        statusDescription: FarmerController.getStatusDescription(deposit.status), // FIXED: Use class name
        depositTime: deposit.createdAt,
        paymentTime: deposit.status === 'completed' ? deposit.updatedAt : null,
        
        // Attendant Info
        recordedBy: deposit.attendant ? {
          name: deposit.attendant.name,
          phone: deposit.attendant.phone
        } : null,
        
        // Actions & Next Steps
        canCollectPayment: deposit.status === 'pending',
        nextStep: FarmerController.getNextStep(deposit.status) // FIXED: Use class name
      }));

      // Get summary statistics
      const summary = await Transaction.aggregate([
        { $match: { fromUser: new mongoose.Types.ObjectId(farmerId), type: 'milk_deposit' } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalLiters: { $sum: '$litersRaw' },
            totalTokens: { $sum: '$tokensAmount' }
          }
        }
      ]);

      // Format summary
      const statusSummary = {
        pending: { count: 0, liters: 0, tokens: 0 },
        completed: { count: 0, liters: 0, tokens: 0 },
        failed: { count: 0, liters: 0, tokens: 0 },
        cancelled: { count: 0, liters: 0, tokens: 0 },
        total: { count: 0, liters: 0, tokens: 0 }
      };

      summary.forEach(item => {
        statusSummary[item._id] = {
          count: item.count,
          liters: item.totalLiters,
          tokens: item.totalTokens
        };
        statusSummary.total.count += item.count;
        statusSummary.total.liters += item.totalLiters;
        statusSummary.total.tokens += item.totalTokens;
      });

      res.json({
        success: true,
        message: 'Deposit history retrieved successfully',
        data: {
          summary: statusSummary,
          deposits: formattedDeposits,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit)),
            totalDeposits: total,
            hasNext: (parseInt(page) * parseInt(limit)) < total,
            hasPrev: parseInt(page) > 1
          }
        }
      });

    } catch (error) {
      console.error('Deposit history error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve deposit history',
        error: error.message
      });
    }
  }
/**
 * Enhanced Farmer Milk Withdrawal - Depot Codes & Verification
 */
static async withdrawMilk(req, res) {
  try {
    const { depotCode, liters, pin } = req.body; // ✅ depotCode instead of depotId
    const farmerId = req.user.id;

    // Step 1: Verify farmer and PIN
    const farmer = await User.findById(farmerId).select('+pin');
    if (!farmer || farmer.role !== 'farmer') {
      return res.status(403).json({
        success: false,
        message: 'Only farmers can withdraw milk'
      });
    }

    const isPinValid = await farmer.comparePin(pin);
    if (!isPinValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid PIN'
      });
    }

    // Step 2: Find depot by CODE (not ID)
    const depot = await Depot.findOne({ code: depotCode.toUpperCase() });
    if (!depot) {
      return res.status(404).json({
        success: false,
        message: 'Depot not found. Please check the depot code.'
      });
    }

    // ✅ DEPOT VERIFICATION - Show depot details for confirmation
    const depotVerification = {
      name: depot.name,
      code: depot.code,
      location: `${depot.location.village}, ${depot.location.subcounty}`,
      availableMilk: depot.stock.pasteurizedMilk + 'L',
      status: depot.status
    };

    // Step 3: Get depot attendant
    const depotAttendant = await User.findOne({ 
      assignedDepot: depot._id, 
      role: 'attendant', 
      status: 'active' 
    });

    if (!depotAttendant) {
      return res.status(400).json({
        success: false,
        message: 'This depot is currently unavailable'
      });
    }

    // Step 4: Validations
    if (depot.stock.pasteurizedMilk < liters) {
      return res.status(400).json({
        success: false,
        message: `Not enough milk available at ${depot.name}. Only ${depot.stock.pasteurizedMilk}L left.`
      });
    }

    const farmerWallet = await Wallet.getOrCreateWallet(farmerId);
    const farmerBalance = farmerWallet.getBalance();
    
    if (farmerBalance < liters) {
      return res.status(400).json({
        success: false,
        message: `Not enough tokens. You have ${farmerBalance} MTZ, need ${liters} MTZ.`
      });
    }

    // Step 5: Process withdrawal
    const paymentResult = await Wallet.transferTokens(
      farmerId,
      depotAttendant._id,
      liters,
      `Milk withdrawal: ${liters}L from ${depot.name} (${depot.code})`
    );

    await depot.removeMilkStock(liters, 'pasteurized');

    const withdrawalTx = await Transaction.create({
      type: 'milk_withdrawal',
      fromUser: farmerId,
      toUser: depotAttendant._id,
      attendant: depotAttendant._id,
      depot: depot._id,
      litersPasteurized: liters,
      tokensAmount: liters,
      status: 'completed',
      notes: `Farmer withdrawal: ${liters}L from ${depot.code}`
    });

    res.json({
      success: true,
      message: `✅ Withdrawal successful!`,
      data: {
        verification: {
          depotVerified: true,
          pinVerified: true,
          transactionVerified: true
        },
        receipt: {
          transactionId: withdrawalTx.reference,
          depot: depotVerification,
          milk: {
            liters: liters,
            type: 'Pasteurized Milk'
          },
          payment: {
            tokensUsed: liters,
            yourNewBalance: paymentResult.fromBalance
          },
          collectedAt: new Date().toLocaleString(),
          attendant: depotAttendant.name
        }
      }
    });

  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({
      success: false,
      message: 'Withdrawal failed. Please try again.',
      error: error.message
    });
  }
}
  /**
   * Get farmer's deposit summary for dashboard
   */
  static async getDepositSummary(req, res) {
    try {
      const farmerId = req.user.id;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      // Get wallet balance
      const wallet = await Wallet.getOrCreateWallet(farmerId);
      
      // Get deposit summary
      const summary = await Transaction.aggregate([
        {
          $match: {
            fromUser: new mongoose.Types.ObjectId(farmerId),
            type: 'milk_deposit',
            createdAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: null,
            totalLiters: { $sum: '$litersRaw' },
            totalTokens: { $sum: '$tokensAmount' },
            pendingDeposits: {
              $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
            },
            completedDeposits: {
              $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
            },
            averageLactometer: { $avg: '$lactometerReading' }
          }
        }
      ]);

      const result = summary[0] || {
        totalLiters: 0,
        totalTokens: 0,
        pendingDeposits: 0,
        completedDeposits: 0,
        averageLactometer: 0
      };

      // Get recent activity (last 5 deposits)
      const recentDeposits = await Transaction.find({
        fromUser: farmerId,
        type: 'milk_deposit'
      })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('depot', 'name code')
      .select('litersRaw qualityGrade status createdAt depositCode shortCode');

      res.json({
        success: true,
        message: 'Deposit summary retrieved',
        data: {
          wallet: {
            balance: wallet.getBalance(),
            currency: 'MTZ'
          },
          last30Days: {
            totalLiters: result.totalLiters || 0,
            totalTokens: result.totalTokens || 0,
            pendingDeposits: result.pendingDeposits || 0,
            completedDeposits: result.completedDeposits || 0,
            averageQuality: result.averageLactometer ? (result.averageLactometer >= 28 ? 'premium' : 'standard') : 'standard'
          },
          recentActivity: recentDeposits.map(deposit => ({
            depositCode: deposit.depositCode,
            shortCode: deposit.shortCode,
            liters: deposit.litersRaw,
            quality: deposit.qualityGrade,
            status: deposit.status,
            depot: deposit.depot.name,
            date: deposit.createdAt
          })),
          quickActions: {
            hasPendingPayments: result.pendingDeposits > 0,
            pendingCount: result.pendingDeposits || 0,
            canRedeem: wallet.getBalance() >= 10 // Minimum redemption threshold
          }
        }
      });

    } catch (error) {
      console.error('Deposit summary error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve deposit summary',
        error: error.message
      });
    }
  }

  /**
   * Get specific deposit details by ID/code
   */
  static async getDepositDetails(req, res) {
    try {
      const farmerId = req.user.id;
      const { depositId } = req.params;

      const deposit = await Transaction.findOne({
        _id: depositId,
        fromUser: farmerId,
        type: 'milk_deposit'
      })
      .populate('depot', 'name code location contact')
      .populate('attendant', 'name phone');

      if (!deposit) {
        return res.status(404).json({
          success: false,
          message: 'Deposit not found'
        });
      }

      // Format detailed response
      const detailedDeposit = {
        // Identification
        depositId: deposit._id,
        depositCode: deposit.depositCode,
        shortCode: deposit.shortCode,
        reference: deposit.reference,
        
        // Depot Information
        depot: {
          name: deposit.depot.name,
          code: deposit.depot.code,
          location: deposit.depot.location,
          contact: deposit.depot.contact
        },
        
        // Milk Details
        milkDetails: {
          liters: deposit.litersRaw,
          quality: deposit.qualityGrade,
          lactometerReading: deposit.lactometerReading,
          qualityDescription: deposit.lactometerReading >= 28 ? 'Premium Quality' : 'Standard Quality',
          lactometerDescription: FarmerController.getLactometerDescription(deposit.lactometerReading) // FIXED
        },
        
        // Financial Details - SIMPLE 1:1 CALCULATION
        tokenDetails: {
          tokensExpected: deposit.litersRaw, // 1 liter = 1 token
          tokensReceived: deposit.status === 'completed' ? deposit.tokensAmount : 0,
          rate: '1 MTZ per liter',
          status: deposit.status,
          statusDescription: FarmerController.getStatusDescription(deposit.status) // FIXED
        },
        
        // Timeline
        timeline: {
          depositedAt: deposit.createdAt,
          paymentProcessedAt: deposit.status === 'completed' ? deposit.updatedAt : null,
          recordedBy: deposit.attendant ? {
            name: deposit.attendant.name,
            phone: deposit.attendant.phone
          } : null
        },
        
        // Actions
        actions: {
          canCollectPayment: deposit.status === 'pending',
          canViewReceipt: deposit.status === 'completed',
          nextStep: FarmerController.getNextStep(deposit.status) // FIXED
        }
      };

      res.json({
        success: true,
        message: 'Deposit details retrieved',
        data: { deposit: detailedDeposit }
      });

    } catch (error) {
      console.error('Deposit details error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve deposit details',
        error: error.message
      });
    }
  }

  /**
   * Helper function to determine next steps
   */
  static getNextStep(status) {
    const steps = {
      pending: 'Visit depot counter to collect your tokens',
      completed: 'Tokens have been paid to your wallet',
      failed: 'Contact depot manager for assistance',
      cancelled: 'Deposit was cancelled - contact depot if this is an error'
    };
    return steps[status] || 'No action required';
  }

  /**
   * Helper function to get status descriptions
   */
  static getStatusDescription(status) {
    const descriptions = {
      pending: 'Milk deposited - awaiting token payment',
      completed: 'Tokens paid successfully',
      failed: 'Payment failed - contact depot',
      cancelled: 'Deposit cancelled'
    };
    return descriptions[status] || status;
  }

  /**
   * Helper function to get lactometer descriptions
   */
  static getLactometerDescription(reading) {
    if (reading >= 28) return 'Excellent - Premium Quality';
    if (reading >= 26) return 'Good - Standard Quality';
    if (reading >= 24) return 'Fair';
    return 'Poor - May be rejected';
  }
}

export default FarmerController;