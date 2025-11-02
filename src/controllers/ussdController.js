// controllers/ussdController.js
import User from '../models/User.js';
import Wallet from '../models/Wallet.js';
import Transaction from '../models/Transaction.js';
import Depot from '../models/Depot.js';

class UssdController {
  
  /**
   * Handle USSD requests
   */
  static async handleUssdRequest(req, res) {
    try {
      const { phoneNumber, text, sessionId } = req.body;
      
      let response = '';
      
      if (text === '') {
        // Initial menu
        response = `CON Welcome to MilkBank!
1. Check Balance
2. Withdraw Milk
3. Send Tokens
4. Transaction History
5. Depot Info`;
        
      } else {
        const inputArray = text.split('*');
        const step = inputArray.length;
        const userInput = inputArray[step - 1];
        
        switch(step) {
          case 1:
            // User selected menu option
            response = await UssdController.handleMenuSelection(phoneNumber, userInput);
            break;
          case 2:
          case 3:
          case 4:
            // Multi-step flows
            response = await UssdController.handleMultiStep(phoneNumber, inputArray);
            break;
        }
      }
      
      res.set('Content-Type', text/plain');
      res.send(response);
      
    } catch (error) {
      res.set('Content-Type', 'text/plain');
      res.send(`END Error: ${error.message}`);
    }
  }
  
  /**
   * Handle menu selection
   */
  static async handleMenuSelection(phoneNumber, choice) {
    const user = await User.findByPhone(phoneNumber);
    if (!user) return 'END User not registered';
    
    switch(choice) {
      case '1':
        // Check Balance
        const wallet = await Wallet.getOrCreateWallet(user._id);
        return `END Your balance: ${wallet.getBalance()} MTZ`;
        
      case '2':
        // Withdraw Milk - Step 1: Enter depot code
        return `CON Enter Depot Code:`;
        
      case '3':
        // Send Tokens - Step 1: Enter recipient phone
        return `CON Enter recipient phone:`;
        
      case '4':
        // Transaction History
        return await UssdController.getTransactionHistory(user._id);
        
      case '5':
        // Depot Info
        return await UssdController.getDepotInfo();
        
      default:
        return 'END Invalid choice';
    }
  }
  
  /**
   * Handle multi-step USSD flows
   */
  static async handleMultiStep(phoneNumber, inputArray) {
    const user = await User.findByPhone(phoneNumber);
    const step = inputArray.length;
    const choice = inputArray[0];
    
    switch(choice) {
      case '2': // Withdraw Milk
        return await UssdController.handleWithdrawalFlow(user, inputArray, step);
        
      case '3': // Send Tokens
        return await UssdController.handleSendTokensFlow(user, inputArray, step);
    }
  }
  
  /**
   * USSD Withdrawal Flow
   */
  static async handleWithdrawalFlow(user, inputArray, step) {
    switch(step) {
      case 2:
        // Step 2: Enter liters
        return `CON Enter liters to withdraw:`;
        
      case 3:
        // Step 3: Enter PIN
        return `CON Enter your PIN:`;
        
      case 4:
        // Step 4: Process withdrawal
        const depotCode = inputArray[1];
        const liters = parseInt(inputArray[2]);
        const pin = inputArray[3];
        
        return await UssdController.processUssdWithdrawal(user, depotCode, liters, pin);
    }
  }
  
  /**
   * Process USSD Withdrawal
   */
  static async processUssdWithdrawal(user, depotCode, liters, pin) {
    try {
      // Verify PIN
      const userWithPin = await User.findById(user._id).select('+pin');
      const isPinValid = await userWithPin.comparePin(pin);
      if (!isPinValid) return 'END Invalid PIN';
      
      // Find depot
      const depot = await Depot.findOne({ code: depotCode.toUpperCase() });
      if (!depot) return 'END Depot not found';
      
      // Check depot stock
      if (depot.stock.pasteurizedMilk < liters) {
        return `END Only ${depot.stock.pasteurizedMilk}L available`;
      }
      
      // Check balance
      const wallet = await Wallet.getOrCreateWallet(user._id);
      if (wallet.getBalance() < liters) {
        return `END Insufficient balance. Need ${liters} MTZ`;
      }
      
      // Get attendant
      const attendant = await User.findOne({ 
        assignedDepot: depot._id, 
        role: 'attendant', 
        status: 'active' 
      });
      
      if (!attendant) return 'END Depot unavailable';
      
      // Process transaction
      await Wallet.transferTokens(user._id, attendant._id, liters, `USSD Withdrawal: ${liters}L`);
      await depot.removeMilkStock(liters, 'pasteurized');
      
      const transaction = await Transaction.create({
        type: 'milk_withdrawal',
        fromUser: user._id,
        toUser: attendant._id,
        attendant: attendant._id,
        depot: depot._id,
        litersPasteurized: liters,
        tokensAmount: liters,
        status: 'completed',
        notes: `USSD withdrawal: ${liters}L`
      });
      
      return `END ✅ Success! ${liters}L from ${depot.name}
Cost: ${liters} MTZ
New Balance: ${wallet.getBalance() - liters} MTZ
TX: ${transaction.reference}`;
      
    } catch (error) {
      return `END Error: ${error.message}`;
    }
  }
  
  /**
   * USSD Send Tokens Flow (P2P)
   */
  static async handleSendTokensFlow(user, inputArray, step) {
    switch(step) {
      case 2:
        return `CON Enter amount to send:`;
        
      case 3:
        return `CON Enter recipient PIN:`;
        
      case 4:
        const recipientPhone = inputArray[1];
        const amount = parseInt(inputArray[2]);
        const pin = inputArray[3];
        
        return await UssdController.processUssdSendTokens(user, recipientPhone, amount, pin);
    }
  }
  
  /**
   * Process USSD P2P Token Transfer
   */
  static async processUssdSendTokens(sender, recipientPhone, amount, pin) {
    try {
      // Verify sender PIN
      const senderWithPin = await User.findById(sender._id).select('+pin');
      const isPinValid = await senderWithPin.comparePin(pin);
      if (!isPinValid) return 'END Invalid PIN';
      
      // Find recipient
      const recipient = await User.findByPhone(recipientPhone);
      if (!recipient) return 'END Recipient not found';
      
      // Check sender balance
      const senderWallet = await Wallet.getOrCreateWallet(sender._id);
      if (senderWallet.getBalance() < amount) {
        return `END Insufficient balance. Need ${amount} MTZ`;
      }
      
      // Transfer tokens
      await Wallet.transferTokens(sender._id, recipient._id, amount, `USSD P2P transfer`);
      
      return `END ✅ Sent ${amount} MTZ to ${recipient.name}
New Balance: ${senderWallet.getBalance() - amount} MTZ`;
      
    } catch (error) {
      return `END Error: ${error.message}`;
    }
  }
}

export default UssdController;