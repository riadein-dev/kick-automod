require('dotenv').config();
const mongoose = require('mongoose');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  
  console.log('--- Collection Stats ---');
  for (const c of collections) {
    const count = await db.collection(c.name).countDocuments();
    console.log(`${c.name}: ${count} docs`);
  }

  // DB stats
  const dbStats = await db.command({ dbStats: 1 });
  console.log('\n--- DB Total ---');
  console.log(`Data Size: ${(dbStats.dataSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Storage Size: ${(dbStats.storageSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Total Size: ${(dbStats.totalSize / 1024 / 1024).toFixed(2)} MB`);
  
  await mongoose.disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });
