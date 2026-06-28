require('dotenv').config();
const mongoose = require('mongoose');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  // Find visitor
  const visitor = await db.collection('visitors').findOne({
    $or: [
      { username: /furkan/i },
      { username: /rumii/i }
    ]
  });
  
  if (visitor) {
    console.log('=== VISITOR FOUND ===');
    console.log('  username:', visitor.username);
    console.log('  kickId:', visitor.kickId);
    console.log('  hasAccess:', visitor.hasAccess);
    console.log('  isAdmin:', visitor.isAdmin);
    console.log('  isBanned:', visitor.isBanned);
    console.log('  loginCount:', visitor.loginCount);
    console.log('  lastLogin:', visitor.lastLogin);
    console.log('  accessToken:', visitor.accessToken ? `${visitor.accessToken.substring(0, 15)}...` : 'MISSING');
    console.log('  refreshToken:', visitor.refreshToken ? `${visitor.refreshToken.substring(0, 15)}...` : 'MISSING');
    console.log('  tokenExpiry:', visitor.tokenExpiry ? new Date(visitor.tokenExpiry).toISOString() : 'NOT SET');
    console.log('  tokenExpired:', visitor.tokenExpiry ? Date.now() > visitor.tokenExpiry : 'UNKNOWN');
  } else {
    console.log('Visitor NOT found with furkan/rumii pattern');
    // Try broader search
    const all = await db.collection('visitors').find({}).project({ username: 1, kickId: 1, hasAccess: 1 }).toArray();
    console.log('\nAll visitors:');
    all.forEach(v => console.log(`  ${v.username} (kickId: ${v.kickId}, hasAccess: ${v.hasAccess})`));
  }

  // Check channels added by this user
  const channels = await db.collection('channels').find({
    $or: [
      { addedBy: /furkan/i },
      { addedBy: /rumii/i }
    ]
  }).toArray();
  console.log('\n=== CHANNELS ===');
  console.log(`  Found ${channels.length} channels for this user`);
  channels.forEach(c => console.log(`  ${c.slug} (chatroomId: ${c.chatroomId}, addedBy: ${c.addedBy})`));

  // Check moderation logs
  const logs = await db.collection('moderationlogs').find({
    $or: [
      { ownerId: /furkan/i },
      { username: /furkan/i }
    ]
  }).limit(5).toArray();
  console.log('\n=== RECENT MOD LOGS ===');
  console.log(`  Found ${logs.length} logs`);
  logs.forEach(l => console.log(`  ${l.action} on ${l.username} - status: ${l.status} - error: ${l.error || 'none'}`));

  await mongoose.disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });
