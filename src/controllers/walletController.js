// src/controllers/walletController.js
import mongoose from 'mongoose';
import User from '../models/User.js';
import Wallet from '../models/Wallet.js'; // ✅ Add Wallet import
import Transaction from '../models/Transaction.js';
import Token from '../models/Token.js';
import { TokenActivity } from '../models/Token.js';

class WalletController {
  /**
   * Get user wallet balance and overview
   */
  static async getWalletBalance(req, res) {
    try {
      const userId = req.user.id;
      const [wallet, token] = await Promise.all([
        Wallet.getOrCreateWallet(userId),
        Token.getToken()
      ]);
      
      res.json({
        success: true,
        message: 'Wallet balance retrieved',
        data: {
          balance: wallet.getBalance(),
          currency: 'MTZ',
          valueInKES: wallet.getBalance() * token.universalPrice.value,
          universalPrice: token.universalPrice.value,
          currencySymbol: 'KSH',
          limits: wallet.limits
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get wallet balance',
        error: error.message
      });
    }
  }

/** 
 * P2P token transfer - WORKING VERSION
 */
static async transferTokens(req, res) {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    const { toUserPhone, tokenAmount, securityPin, notes } = req.body;
    const fromUserId = req.user.id;

    // Validation
    if (!securityPin || !toUserPhone) {
      throw new Error('Security PIN and recipient phone are required');
    }

    const [fromUser, toUser] = await Promise.all([
      User.findById(fromUserId).select('+pin'),
      User.findOne({ phone: toUserPhone })
    ]);

    if (!fromUser || !toUser) {
      throw new Error('User not found');
    }

    // Verify PIN
    const isPinValid = await fromUser.comparePin(securityPin);
    if (!isPinValid) {
      throw new Error('Invalid security PIN');
    }

    // Get wallets
    const fromWallet = await Wallet.findOne({ user: fromUserId }).session(session);
    const toWallet = await Wallet.findOne({ user: toUser._id }).session(session) || 
                     await Wallet.create([{ user: toUser._id }], { session }).then(wallets => wallets[0]);

    if (!fromWallet.canSend(tokenAmount)) {
      throw new Error('Insufficient balance');
    }

    // Transfer tokens
    await fromWallet.deductTokens(tokenAmount, session);
    await toWallet.addTokens(tokenAmount, session);

    // ✅ CREATE TRANSACTION DIRECTLY - NO BROKEN METHODS
    const transactionData = {
      type: 'token_transfer',
      fromUser: fromUserId,    // Just pass the ID directly
      toUser: toUser._id,      // Just pass the ID directly
      tokensAmount: tokenAmount,
      fees: {
        amount: 0,
        rate: 0,
        type: 'p2p_transfer'
      },
      status: 'completed',
      notes: notes || `P2P transfer to ${toUser.name}`
    };

    // Save transaction directly
    const Transaction = mongoose.model('Transaction');
    const transaction = new Transaction(transactionData);
    const savedTx = await transaction.save({ session });

    await session.commitTransaction();

    res.json({
      success: true,
      message: `${tokenAmount} MTZ transferred to ${toUser.name}`,
      data: {
        receipt: {
          transactionId: savedTx._id,
          tokensSent: tokenAmount,
          fromBalance: fromWallet.balances.MTZ - tokenAmount,
          toUser: {
            name: toUser.name,
            phone: toUser.phone
          }
        }
      }
    });

  } catch (error) {
    await session.abortTransaction();
    res.status(400).json({
      success: false,
      message: 'Transfer failed',
      error: error.message
    });
  } finally {
    session.endSession();
  }
}

  /**
   * Cash redemption - Burn tokens and send M-Pesa
   */
  static async cashRedemption(req, res) {
    try {
      const { tokenAmount } = req.body;
      const userId = req.user.id;

      const [user, wallet, token] = await Promise.all([
        User.findById(userId),
        Wallet.getOrCreateWallet(userId),
        Token.getToken()
      ]);

      // ✅ Check wallet balance instead of user.tokenBalance
      if (wallet.getBalance() < tokenAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient tokens. Available: ${wallet.getBalance()}, Requested: ${tokenAmount}`
        });
      }

      // Verify minimum redemption
      if (tokenAmount < token.redemptionRules.minRedemption) {
        return res.status(400).json({
          success: false,
          message: `Minimum redemption is ${token.redemptionRules.minRedemption} MTZ`
        });
      }

      // Calculate redemption value
      const redemption = Token.calculateRedemptionValue(tokenAmount);

      // Create redemption transaction
      const redemptionTx = new Transaction({
        type: 'cash_redemption',
        fromUser: userId,
        toUser: userId,
        attendant: userId, // Self-service
        depot: user.assignedDepot || null,
        tokensAmount: tokenAmount,
        cashAmount: redemption.netValue,
        status: 'pending' // Wait for M-Pesa confirmation
      });

      await redemptionTx.save();

      // ✅ Use wallet.deductTokens instead of user.updateTokenBalance
      await wallet.deductTokens(tokenAmount);
      
      // Burn tokens
      await Token.burnTokens(tokenAmount, 'cash_redemption');

      // TODO: Integrate with M-Pesa API

      res.json({
        success: true,
        message: `Redemption processed - ${redemption.netValue} KSH sent via M-Pesa`,
        data: {
          receipt: {
            transactionId: redemptionTx.reference,
            tokensRedeemed: tokenAmount,
            redemptionValue: redemption.netValue,
            fee: redemption.fee,
            feeValue: redemption.fee * token.universalPrice.value,
            newBalance: wallet.getBalance(),
            mpesaStatus: 'processing'
          }
        }
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Redemption failed',
        error: error.message
      });
    }
  }

  /**
   * ADMIN: Transfer float to depot/user
   */
  static async transferFloat(req, res) {
    try {
      const { recipientId, amount, purpose } = req.body;
      const adminId = req.user.id;

      // Verify admin role
      const admin = await User.findById(adminId);
      if (!admin.isAdmin()) {
        return res.status(403).json({
          success: false,
          message: 'Only admins can transfer float'
        });
      }

      const recipient = await User.findById(recipientId);
      if (!recipient) {
        return res.status(404).json({
          success: false,
          message: 'Recipient not found'
        });
      }

      // ✅ Transfer from system/admin wallet to recipient
      const transferResult = await Wallet.transferTokens(
        adminId, // From admin/system
        recipientId, // To recipient
        amount,
        purpose || 'Float transfer'
      );

      res.json({
        success: true,
        message: `${amount} MTZ float transferred to ${recipient.name}`,
        data: {
          recipient: {
            name: recipient.name,
            phone: recipient.phone,
            role: recipient.role
          },
          amount: amount,
          newBalance: transferResult.toBalance,
          purpose: purpose
        }
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Float transfer failed',
        error: error.message
      });
    }
  }

 /**
   * Get wallet transaction history 
   */
  static async getTransactionHistory(req, res) {
    try {
      const { page = 1, limit = 20, type } = req.query;
      const userId = req.user.id;
      
      let query = {
        $or: [{ fromUser: userId }, { toUser: userId }]
      };
      
      if (type) {
        query.type = type;
      }
      
      const transactions = await Transaction.find(query)
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .populate('fromUser', 'name phone')
        .populate('toUser', 'name phone')
        .populate('depot', 'name code');

      const total = await Transaction.countDocuments(query);

      res.json({
        success: true,
        message: 'Transaction history retrieved',
        data: {
          transactions,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalTransactions: total
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get transaction history',
        error: error.message
      });
    }
  }


  /**
   * Get token metrics and economics (Public)
   */
  static async getTokenMetrics(req, res) {
    try {
      const token = await Token.getToken();
      
      res.json({
        success: true,
        message: 'Token metrics retrieved',
        data: token.getTokenMetrics()
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get token metrics',
        error: error.message
      });
    }
  }
 
  /**
   * Calculate token value for different operations
   */
  static async calculateValue(req, res) {
    try {
      const { tokenAmount, operation } = req.body; // operation: 'transfer', 'redeem', or 'current'

      const token = await Token.getToken();
      
      let calculation;
      switch (operation) {
        case 'transfer':
          const fee = Math.min(
            tokenAmount * token.feeStructure.p2pTransfer.rate,
            token.feeStructure.p2pTransfer.maxFee / token.universalPrice.value
          );
          calculation = {
            operation: 'transfer',
            grossAmount: tokenAmount,
            fee: fee,
            netAmount: tokenAmount - fee,
            grossValue: tokenAmount * token.universalPrice.value,
            netValue: (tokenAmount - fee) * token.universalPrice.value,
            feeValue: fee * token.universalPrice.value
          };
          break;
        
        case 'redeem':
          const redemption = Token.calculateRedemptionValue(tokenAmount);
          calculation = {
            operation: 'redemption',
            ...redemption
          };
          break;
        
        default:
          calculation = {
            operation: 'current_value',
            tokenAmount: tokenAmount,
            valueInKES: tokenAmount * token.universalPrice.value,
            universalPrice: token.universalPrice.value
          };
      }

      res.json({
        success: true,
        message: 'Token value calculated',
        data: calculation
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Calculation failed',
        error: error.message
      });
    }
  }

  /**
   * ADMIN: Update universal price (admin only)
   */
  static async updateUniversalPrice(req, res) {
    try {
      const { newPrice, reason } = req.body;

      if (!newPrice || newPrice <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid new price required'
        });
      }

      const token = await Token.updateUniversalPrice(newPrice, reason);

      res.json({
        success: true,
        message: `Universal price updated to ${newPrice} KSH`,
        data: {
          oldPrice: token.universalPrice.value,
          newPrice: newPrice,
          reason: reason,
          nextReview: token.universalPrice.nextReview
        }
      });

    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Price update failed',
        error: error.message
      });
    }
  }

  /**
   * ADMIN: Get token activity log (admin only)
   */
  static async getTokenActivity(req, res) {
    try {
      const { type, startDate, endDate, page = 1, limit = 50 } = req.query;

      const query = {};
      if (type) query.type = type;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const activities = await TokenActivity.find(query)
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .populate('initiatedBy', 'name phone');

      const total = await TokenActivity.countDocuments(query);

      res.json({
        success: true,
        message: 'Token activity retrieved',
        data: {
          activities,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalActivities: total
          }
        }
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get token activity',
        error: error.message
      });
    }
  }
}

export default WalletController;