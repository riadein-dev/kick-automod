/**
 * MongoDB Cleanup Script
 * Removes bloated data to reduce storage below 440MB limit
 */
require('dotenv').config();
const mongoose = require('mongoose');

async function cleanup() {
  if (!process.env.MONGODB_URI) {
    console.log('MONGODB_URI not found');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  
  // 1. Show collection doc counts
  console.log('\n=== Collection Document Counts ===');
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    const count = await db.collection(col.name).countDocuments();
    console.log(`  ${col.name}: ${count} docs`);
  }

  // 2. Clean rawData from visitors (biggest space saver)
  console.log('\n=== Cleaning rawData from visitors ===');
  const visitorResult = await db.collection('visitors').updateMany(
    { rawData: { $exists: true, $ne: null } },
    { $set: { rawData: null } }
  );
  console.log(`  Updated ${visitorResult.modifiedCount} visitors (rawData removed)`);

  // 3. Delete old chat messages (older than 2 days)
  console.log('\n=== Cleaning old chat messages ===');
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const chatResult = await db.collection('chatmessages').deleteMany({
    createdAt: { $lt: twoDaysAgo }
  });
  console.log(`  Deleted ${chatResult.deletedCount} old chat messages`);

  // 4. Delete old moderation logs (older than 3 days)
  console.log('\n=== Cleaning old moderation logs ===');
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const modResult = await db.collection('moderationlogs').deleteMany({
    createdAt: { $lt: threeDaysAgo }
  });
  console.log(`  Deleted ${modResult.deletedCount} old moderation logs`);

  // 5. Delete used invite codes
  console.log('\n=== Cleaning used invite codes ===');
  const inviteResult = await db.collection('invitecodes').deleteMany({
    used: true
  });
  console.log(`  Deleted ${inviteResult.deletedCount} used invite codes`);

  // 6. Show new counts
  console.log('\n=== NEW Document Counts ===');
  for (const col of collections) {
    try {
      const count = await db.collection(col.name).countDocuments();
      console.log(`  ${col.name}: ${count} docs`);
    } catch(e) {
      console.log(`  ${col.name}: error`);
    }
  }

  // 7. Run compact (request server to reclaim space)
  console.log('\n=== Requesting compaction ===');
  for (const col of collections) {
    try {
      await db.command({ compact: col.name });
      console.log(`  Compacted: ${col.name}`);
    } catch(e) {
      console.log(`  ${col.name}: ${e.message}`);
    }
  }

  await mongoose.disconnect();
  console.log('\nDone! Disconnected.');
}

cleanup().catch(err => {
  console.error('Cleanup error:', err);
  process.exit(1);
});
