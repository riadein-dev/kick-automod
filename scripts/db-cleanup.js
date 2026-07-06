require('dotenv').config();
const mongoose = require('mongoose');

async function cleanup() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  console.log('=== GÜVENLİ TEMİZLİK BAŞLIYOR ===\n');

  // Tarihler STRING olarak saklandığı için ISO string ile karşılaştır
  const chatCutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 gün
  const modCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();  // 7 gün

  // 1. Chat mesajları - 3 günden eski (string karşılaştırma)
  const chatBefore = await db.collection('chatmessages').countDocuments();
  const chatResult = await db.collection('chatmessages').deleteMany({
    timestamp: { $lt: chatCutoff }
  });
  const chatAfter = await db.collection('chatmessages').countDocuments();
  console.log(`[Chat] ${chatBefore} -> ${chatAfter} (${chatResult.deletedCount} silindi)`);

  // 2. Mod logları - 7 günden eski
  const modBefore = await db.collection('moderationlogs').countDocuments();
  const modResult = await db.collection('moderationlogs').deleteMany({
    createdAt: { $lt: modCutoff }
  });
  const modAfter = await db.collection('moderationlogs').countDocuments();
  console.log(`[ModLog] ${modBefore} -> ${modAfter} (${modResult.deletedCount} silindi)`);

  // 3. Duplicate kelimeler (aynı word+action+channel+addedBy)
  const allWords = await db.collection('words').find({}).toArray();
  const seen = new Map();
  const dupIds = [];
  for (const w of allWords) {
    const key = `${(w.word||'').toLowerCase()}|${w.action}|${w.channel}|${w.addedBy}`;
    if (seen.has(key)) {
      dupIds.push(w._id);
    } else {
      seen.set(key, w);
    }
  }
  if (dupIds.length > 0) {
    await db.collection('words').deleteMany({ _id: { $in: dupIds } });
  }
  const wordsAfter = await db.collection('words').countDocuments();
  console.log(`[Words] ${allWords.length} -> ${wordsAfter} (${dupIds.length} duplicate silindi)`);

  // SONUÇ
  console.log('\n=== KORUNAN VERİLER ===');
  console.log(`visitors: ${await db.collection('visitors').countDocuments()}`);
  console.log(`channels: ${await db.collection('channels').countDocuments()}`);
  console.log(`automodrules: ${await db.collection('automodrules').countDocuments()}`);
  console.log(`words: ${wordsAfter}`);
  console.log(`invitecodes: ${await db.collection('invitecodes').countDocuments()}`);
  console.log(`wordpresets: ${await db.collection('wordpresets').countDocuments()}`);

  const dbStats = await db.command({ dbStats: 1 });
  console.log(`\nData Size: ${(dbStats.dataSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Storage Size: ${(dbStats.storageSize / 1024 / 1024).toFixed(2)} MB`);
  console.log('\n✅ Temizlik tamamlandı!');
  await mongoose.disconnect();
}

cleanup().catch(e => { console.error(e); process.exit(1); });
