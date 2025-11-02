// scripts/mintInitialTokens.js
import mongoose from 'mongoose';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

const mintInitialTokens = async () => {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/milkbank');
    console.log('✅ Connected to MongoDB');

    // Import models using dynamic imports
    const TokenModule = await import(`file://${join(__dirname, '..', 'src', 'models', 'Token.js')}`);
    const Token = TokenModule.default;
    
    const WalletModule = await import(`file://${join(__dirname, '..', 'src', 'models', 'Wallet.js')}`);
    const Wallet = WalletModule.default;
    
    const UserModule = await import(`file://${join(__dirname, '..', 'src', 'models', 'User.js')}`);
    const User = UserModule.default;

    console.log('\n💰 CHECKING TOKEN SYSTEM...');

    // Get or create token
    let token = await Token.findOne({ symbol: 'MTZ' });
    if (!token) {
      console.log('🚀 Creating MTZ token...');
      token = await Token.create({});
      console.log('✅ MTZ token created');
    } else {
      console.log('✅ MTZ token already exists');
    }

    console.log('\n📊 CURRENT TOKEN STATUS:');
    console.log(`Symbol: ${token.symbol}`);
    console.log(`Name: ${token.name}`);
    console.log(`Total Supply: ${token.totalSupply.toLocaleString()} MTZ`);
    console.log(`Circulating Supply: ${token.circulatingSupply.toLocaleString()} MTZ`);
    console.log(`Universal Price: ${token.universalPrice.value} KSH`);

    // Mint initial supply if needed
    if (token.totalSupply === 0) {
      console.log('\n🎯 MINTING INITIAL TOKEN SUPPLY...');
      
      try {
        // Mint 10 million MTZ
        await Token.mintTokens(10000000, 'initial_supply');
        console.log('✅ 10,000,000 MTZ minted successfully!');
        
        // Refresh token data
        token = await Token.findOne({ symbol: 'MTZ' });
        
        console.log('\n📈 UPDATED TOKEN STATUS:');
        console.log(`Total Supply: ${token.totalSupply.toLocaleString()} MTZ`);
        console.log(`Circulating Supply: ${token.circulatingSupply.toLocaleString()} MTZ`);
        console.log(`Market Cap: ${(token.circulatingSupply * token.universalPrice.value).toLocaleString()} KSH`);
        
      } catch (mintError) {
        console.error('❌ Minting failed:', mintError.message);
        throw mintError;
      }
    } else {
      console.log('⏭️  Tokens already minted, skipping minting...');
    }

    // Find system admin to hold initial tokens
    console.log('\n👨‍💼 FINDING SYSTEM ADMIN...');
    const systemAdmin = await User.findOne({ email: 'superadmin@milkbank.com' });
    
    if (systemAdmin) {
      console.log(`✅ Found System Admin: ${systemAdmin.name}`);
      
      const adminWallet = await Wallet.getOrCreateWallet(systemAdmin._id);
      console.log(`💰 System Admin current balance: ${adminWallet.getBalance().toLocaleString()} MTZ`);
      
      // If admin has less than total supply, transfer the difference
      const tokensToTransfer = token.circulatingSupply - adminWallet.getBalance();
      
      if (tokensToTransfer > 0) {
        console.log(`\n🔄 TRANSFERRING ${tokensToTransfer.toLocaleString()} MTZ TO SYSTEM ADMIN...`);
        
        // Since we can't transfer from "nowhere", we'll directly add to admin wallet
        // This simulates the system owning the tokens initially
        await adminWallet.addTokens(tokensToTransfer);
        
        console.log(`✅ ${tokensToTransfer.toLocaleString()} MTZ transferred to System Admin`);
        console.log(`💰 System Admin new balance: ${adminWallet.getBalance().toLocaleString()} MTZ`);
      } else {
        console.log('⏭️  System Admin already has sufficient tokens');
      }
      
    } else {
      console.log('❌ System admin not found. Please create a super admin first.');
      console.log('💡 Create user with email: superadmin@milkbank.com');
    }

    // Final summary
    console.log('\n🎉 TOKEN SYSTEM INITIALIZATION COMPLETE!');
    console.log('========================================');
    console.log(`💰 Total Supply: ${token.totalSupply.toLocaleString()} MTZ`);
    console.log(`🔄 Circulating: ${token.circulatingSupply.toLocaleString()} MTZ`);
    console.log(`💵 Universal Price: ${token.universalPrice.value} KSH`);
    console.log(`📈 Market Cap: ${(token.circulatingSupply * token.universalPrice.value).toLocaleString()} KSH`);
    
    if (systemAdmin) {
      const finalAdminWallet = await Wallet.getOrCreateWallet(systemAdmin._id);
      console.log(`👨‍💼 System Admin Balance: ${finalAdminWallet.getBalance().toLocaleString()} MTZ`);
    }
    
    console.log('\n🚀 NEXT STEPS:');
    console.log('1. Admin can now transfer float to depot attendants');
    console.log('2. Mary can receive tokens and pay farmers for milk deposits');
    console.log('3. Farmers can transfer, withdraw milk, or redeem for cash');

  } catch (error) {
    console.error('❌ Token initialization failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
};

// Run the minting script
mintInitialTokens();