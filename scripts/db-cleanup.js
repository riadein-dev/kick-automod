require('dotenv').config();
const mongoose = require('mongoose');

async function cleanup() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  console.log('=== MEVCUT DURUM ===');
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    const count = await db.collection(col.name).countDocuments();
    console.log(`  ${col.name}: ${count} docs`);
  }

  // SADECE geçici/buffer verileri temizle
  // Kullanıcı verilerine (visitors, channels, words, automodrules) DOKUNMA

  // 1. Chat mesajları - sadece buffer, son 12 saati tut
  console.log('\n[1/3] Chat mesajları temizleniyor (son 12 saat korunuyor)...');
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const chatResult = await db.collection('chatmessages').deleteMany({
    $or: [
      { createdAt: { $lt: twelveHoursAgo } },
      { createdAt: { $exists: false } }  // TTL indexi olmayan eski kayıtlar
    ]
  });
  console.log(`  ✅ ${chatResult.deletedCount} eski chat mesajı silindi`);

  // 2. Moderasyon logları - son 3 günü tut
  console.log('\n[2/3] Eski moderasyon logları temizleniyor (son 3 gün korunuyor)...');
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const modResult = await db.collection('moderationlogs').deleteMany({
    $or: [
      { createdAt: { $lt: threeDaysAgo } },
      { createdAt: { $exists: false } }
    ]
  });
  console.log(`  ✅ ${modResult.deletedCount} eski moderasyon logu silindi`);

  // 3. Expired word presets (7 günden eski)
  console.log('\n[3/3] Süresi dolmuş preset\'ler temizleniyor...');
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const presetResult = await db.collection('wordpresets').deleteMany({
    createdAt: { $lt: sevenDaysAgo }
  });
  console.log(`  ✅ ${presetResult.deletedCount} eski preset silindi`);

  console.log('\n=== TEMİZLİK SONRASI ===');
  for (const col of collections) {
    try {
      const count = await db.collection(col.name).countDocuments();
      console.log(`  ${col.name}: ${count} docs`);
    } catch(e) { console.log(`  ${col.name}: hata`); }
  }

  console.log('\n⚠️  DOKUNULMAYAN VERİLER: visitors, channels, words, automodrules, invitecodes');
  await mongoose.disconnect();
  console.log('Bitti!');
}

cleanup().catch(e => { console.error(e); process.exit(1); });
