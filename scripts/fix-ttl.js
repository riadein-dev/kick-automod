require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const db = mongoose.connection.db;

  try {
      await db.collection('chatmessages').dropIndex('createdAt_1');
      console.log('Dropped chatmessages TTL index');
  } catch (e) {
      console.log('chatmessages TTL index drop error or not found:', e.message);
  }

  try {
      await db.collection('moderationlogs').dropIndex('createdAt_1');
      console.log('Dropped moderationlogs TTL index');
  } catch (e) {
      console.log('moderationlogs TTL index drop error or not found:', e.message);
  }

  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
