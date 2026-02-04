// test-new-cluster.js
import { MongoClient } from 'mongodb';

const uri = 'mongodb+srv://kxbytetech_db_user:5595@cluster0.03dwwql.mongodb.net/milkbank?retryWrites=true&w=majority';

async function test() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    console.log('✅ Connected to new cluster');
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.log('\nGo to MongoDB Atlas and:');
    console.log('1. Network Access → Add IP Address → 0.0.0.0/0');
    console.log('2. Database Access → Create user kxbytetech_db_user');
    console.log('3. Copy correct password from Atlas');
  } finally {
    await client.close();
  }
}

test();