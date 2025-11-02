import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import Token from '../models/Token.js';
import User from '../models/User.js';

class MpesaController {
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

      // Check wallet balance
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
        attendant: userId,
        depot: user.assignedDepot || null,
        tokensAmount: tokenAmount,
        cashAmount: redemption.netValue,
        status: 'pending' // Wait for M-Pesa confirmation
      });

      await redemptionTx.save();

      // Deduct tokens and burn them
      await wallet.deductTokens(tokenAmount);
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
   * M-Pesa callback handler (for future integration)
   */
  static async mpesaCallback(req, res) {
    // TODO: Implement M-Pesa callback handling
    res.json({ 
      success: true, 
      message: 'M-Pesa callback received - TODO: Implement processing' 
    });
  }
}

export default MpesaController;