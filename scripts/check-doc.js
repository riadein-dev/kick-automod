require('dotenv').config();
const mongoose = require('mongoose');

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  // Sample chat message
  const chat = await db.collection('chatmessages').findOne({});
  console.log('=== CHAT MESSAGE SAMPLE ===');
  console.log(JSON.stringify(chat, null, 2).substring(0, 500));

  // Sample mod log
  const mod = await db.collection('moderationlogs').findOne({});
  console.log('\n=== MOD LOG SAMPLE ===');
  console.log(JSON.stringify(mod, null, 2).substring(0, 500));

  await mongoose.disconnect();
}
check().catch(e => { console.error(e); process.exit(1); });
