require('dotenv').config();
const mongoose = require('mongoose');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  // 1. Visitor record
  const visitor = await db.collection('visitors').findOne({ username: /furkan/i });
  console.log('=== VISITOR ===');
  if (visitor) {
    console.log('  username:', visitor.username);
    console.log('  kickId:', visitor.kickId);
    console.log('  hasAccess:', visitor.hasAccess);
    console.log('  accessToken:', visitor.accessToken ? `${visitor.accessToken.substring(0, 20)}...` : 'MISSING');
    console.log('  refreshToken:', visitor.refreshToken ? `${visitor.refreshToken.substring(0, 20)}...` : 'MISSING');
    console.log('  tokenExpiry:', visitor.tokenExpiry ? new Date(visitor.tokenExpiry).toISOString() : 'NOT SET');
    console.log('  tokenExpired:', visitor.tokenExpiry ? Date.now() > visitor.tokenExpiry : 'UNKNOWN');
  } else {
    console.log('  NOT FOUND');
  }

  // 2. Channels added by this user
  const channels = await db.collection('channels').find({ addedBy: /furkan/i }).toArray();
  console.log('\n=== CHANNELS ===');
  console.log(`  ${channels.length} channels:`);
  channels.forEach(c => console.log(`  - ${c.slug} (chatroomId: ${c.chatroomId}, userId: ${c.userId})`));

  // 3. Automod rules
  const rules = await db.collection('automodrules').findOne({ $or: [{ userId: /furkan/i }, { addedBy: /furkan/i }] });
  console.log('\n=== AUTOMOD RULES ===');
  if (rules) {
    console.log('  enabled:', rules.enabled);
    console.log('  mode:', rules.mode);
    console.log('  bannedWordsEnabled:', rules.bannedWordsEnabled);
    console.log('  userId:', rules.userId);
  } else {
    console.log('  NO RULES FOUND');
  }

  // 4. Words added by this user
  const words = await db.collection('words').find({ addedBy: /furkan/i }).toArray();
  console.log('\n=== WORDS ===');
  console.log(`  ${words.length} words:`);
  words.forEach(w => console.log(`  - "${w.word}" action=${w.action} channel=${w.channel} enabled=${w.enabled}`));

  // 5. Recent moderation logs
  const logs = await db.collection('moderationlogs').find({ ownerId: /furkan/i }).sort({ createdAt: -1 }).limit(5).toArray();
  console.log('\n=== RECENT MOD LOGS ===');
  logs.forEach(l => console.log(`  ${l.action} on ${l.username} - status=${l.status} - error=${l.error || 'none'} - ${l.createdAt}`));

  await mongoose.disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });
