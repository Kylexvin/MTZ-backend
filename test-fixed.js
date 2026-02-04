import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { MongoClient } from 'mongodb';

const uri = 'mongodb+srv://kxbytetech_db_user:5595@cluster0.03dwwql.mongodb.net/milkbank?retryWrites=true&w=majority';

async function test() {
  const client = new MongoClient(uri, { 
    serverSelectionTimeoutMS: 5000,
    family: 4 // Force IPv4
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to new cluster');
  } catch (err) {
    console.error('❌ Error:', err.message);
    
    if (err.message.includes('querySrv')) {
      console.log('\n🔧 WINDOWS DNS FIX REQUIRED!');
      console.log('Run this command then try again:');
      console.log('NODE_OPTIONS="--dns-result-order=ipv4first" node test-fixed.js');
    }
  } finally {
    await client.close();
  }
}

test();