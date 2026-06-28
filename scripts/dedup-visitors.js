require('dotenv').config();
const mongoose = require('mongoose');

async function dedup() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  const visitors = await db.collection('visitors').find({}).toArray();
  console.log(`Total visitor records: ${visitors.length}`);
  
  // Group by username
  const grouped = {};
  for (const v of visitors) {
    const key = (v.username || '').toLowerCase();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(v);
  }
  
  let deleted = 0;
  for (const [username, records] of Object.entries(grouped)) {
    if (records.length <= 1) continue;
    
    // Keep the record with highest loginCount, or the one with kickId, or the most recent
    records.sort((a, b) => {
      // Prefer records with kickId
      if (a.kickId && !b.kickId) return -1;
      if (!a.kickId && b.kickId) return 1;
      // Prefer records with hasAccess
      if (a.hasAccess && !b.hasAccess) return -1;
      if (!a.hasAccess && b.hasAccess) return 1;
      // Prefer records with accessToken
      if (a.accessToken && !b.accessToken) return -1;
      if (!a.accessToken && b.accessToken) return 1;
      // Prefer higher loginCount
      return (b.loginCount || 0) - (a.loginCount || 0);
    });
    
    const keep = records[0];
    const toDelete = records.slice(1);
    
    console.log(`\n${username}: ${records.length} records, keeping id=${keep.id} (loginCount=${keep.loginCount}, kickId=${keep.kickId})`);
    
    // Merge important fields from duplicates into the keeper
    for (const dup of toDelete) {
      if (dup.kickId && !keep.kickId) keep.kickId = dup.kickId;
      if (dup.accessToken && !keep.accessToken) keep.accessToken = dup.accessToken;
      if (dup.refreshToken && !keep.refreshToken) keep.refreshToken = dup.refreshToken;
      if (dup.tokenExpiry && !keep.tokenExpiry) keep.tokenExpiry = dup.tokenExpiry;
      if (dup.hasAccess) keep.hasAccess = true;
    }
    
    // Update keeper with merged data
    await db.collection('visitors').updateOne({ _id: keep._id }, { $set: keep });
    
    // Delete duplicates
    const dupIds = toDelete.map(d => d._id);
    const result = await db.collection('visitors').deleteMany({ _id: { $in: dupIds } });
    deleted += result.deletedCount;
    console.log(`  Deleted ${result.deletedCount} duplicates`);
  }
  
  console.log(`\n=== SUMMARY ===`);
  console.log(`Deleted ${deleted} duplicate records`);
  const remaining = await db.collection('visitors').countDocuments();
  console.log(`Remaining visitors: ${remaining}`);
  
  await mongoose.disconnect();
}

dedup().catch(e => { console.error(e); process.exit(1); });
