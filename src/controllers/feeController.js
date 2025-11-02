// src/controllers/feeController.js
import Token from '../models/Token.js';

class FeeController {
  /**
   * Get current fee settings
   */
  static async getFeeSettings(req, res) {
    try {
      const token = await Token.getToken();
      
      res.json({
        success: true,
        data: {
          p2pTransfer: token.feeStructure.p2pTransfer,
          cashRedemption: token.redemptionRules,
          withdrawalService: token.feeStructure.withdrawalService
        }
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to fetch fee settings',
        error: error.message
      });
    }
  }

  /**
   * Update P2P transfer fees (Admin only)
   */
  static async updateP2PFees(req, res) {
    try {
      const { rate, maxFee, minTransfer } = req.body;
      const token = await Token.getToken();

      // Update P2P fee settings
      if (rate !== undefined) {
        token.feeStructure.p2pTransfer.rate = rate;
      }
      if (maxFee !== undefined) {
        token.feeStructure.p2pTransfer.maxFee = maxFee;
      }
      if (minTransfer !== undefined) {
        token.feeStructure.p2pTransfer.minTransfer = minTransfer;
      }

      await token.save();

      res.json({
        success: true,
        message: 'P2P transfer fees updated successfully',
        data: {
          p2pTransfer: token.feeStructure.p2pTransfer
        }
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to update fees',
        error: error.message
      });
    }
  }

  /**
   * Update cash redemption fees (Admin only)
   */
  static async updateRedemptionFees(req, res) {
    try {
      const { cashRedemptionFee, minRedemption } = req.body;
      const token = await Token.getToken();

      if (cashRedemptionFee !== undefined) {
        token.redemptionRules.cashRedemptionFee = cashRedemptionFee;
      }
      if (minRedemption !== undefined) {
        token.redemptionRules.minRedemption = minRedemption;
      }

      await token.save();

      res.json({
        success: true,
        message: 'Redemption fees updated successfully',
        data: {
          redemptionRules: token.redemptionRules
        }
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to update redemption fees',
        error: error.message
      });
    }
  }

  /**
   * Get fee statistics (Admin only)
   */
  static async getFeeStats(req, res) {
    try {
      const token = await Token.getToken();
      
      res.json({
        success: true,
        data: {
          totalFeesCollected: token.feeStats?.totalFeesCollected || 0,
          p2pFees: token.feeStats?.p2pFees || { collected: 0, transactions: 0 },
          redemptionFees: token.feeStats?.redemptionFees || { collected: 0, transactions: 0 }
        }
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Failed to fetch fee statistics',
        error: error.message
      });
    }
  }
}

export default FeeController;