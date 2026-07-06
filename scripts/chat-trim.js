require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const cutoff = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
  console.log('Cutoff:', cutoff);
  const before = await db.collection('chatmessages').countDocuments();
  const r = await db.collection('chatmessages').deleteMany({ timestamp: { $lt: cutoff } });
  const after = await db.collection('chatmessages').countDocuments();
  console.log('Chat:', before, '->', after, '(' + r.deletedCount + ' silindi)');
  const s = await db.command({ dbStats: 1 });
  console.log('Data:', (s.dataSize/1024/1024).toFixed(1), 'MB, Storage:', (s.storageSize/1024/1024).toFixed(1), 'MB');
  await mongoose.disconnect();
}
run().catch(e => { console.error(e); process.exit(1); });
