import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import Depot from '../models/Depot.js';
import User from '../models/User.js';

class WithdrawalController {
  /**
   * Enhanced Farmer Milk Withdrawal - Depot Codes & Verification
   */
  static async withdrawMilk(req, res) {
    try {
      const { depotCode, liters, pin } = req.body;
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

      // Step 2: Find depot by CODE
      const depot = await Depot.findOne({ code: depotCode.toUpperCase() });
      if (!depot) {
        return res.status(404).json({
          success: false,
          message: 'Depot not found. Please check the depot code.'
        });
      }

      // Depot verification details
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

}

export default WithdrawalController;