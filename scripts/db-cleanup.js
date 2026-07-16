require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const db = mongoose.connection.db;

  // 1. Chat mesajlarini temizle (son 24 saat haric)
  const oneDayAgo = new Date(Date.now() - 24*60*60*1000);
  const chat = await db.collection('chatmessages').deleteMany({ createdAt: { $lt: oneDayAgo } });
  console.log('Chat mesajlari silindi:', chat.deletedCount);

  // 2. Eski mod loglarini temizle (1 gunlukten eski)
  const logs = await db.collection('moderationlogs').deleteMany({ createdAt: { $lt: oneDayAgo } });
  console.log('Eski mod loglari silindi:', logs.deletedCount);

  const threeDaysAgo = new Date(Date.now() - 3*24*60*60*1000);
  // 3. Eski presetleri temizle
  const presets = await db.collection('wordpresets').deleteMany({ createdAt: { $lt: threeDaysAgo } });
  console.log('Eski presetler silindi:', presets.deletedCount);

  // 4. Crossban loglarini temizle
  const crossban = await db.collection('crossbanlogs').deleteMany({});
  console.log('Crossban loglari silindi:', crossban.deletedCount);

  // Sonuc
  const stats = await db.stats();
  console.log('\n--- TEMIZLIK SONRASI ---');
  console.log('DB Boyutu:', (stats.dataSize / 1024 / 1024).toFixed(2), 'MB');
  console.log('Storage:', (stats.storageSize / 1024 / 1024).toFixed(2), 'MB');

  // Koleksiyon bazinda kontrol
  const cols = await db.listCollections().toArray();
  for (const c of cols) {
    const count = await db.collection(c.name).countDocuments();
    console.log(c.name, ':', count, 'doc');
  }

  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
