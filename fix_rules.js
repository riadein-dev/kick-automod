const mongoose = require('mongoose');
require('dotenv').config();

async function fix() {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    
    // Eski bozuk index'i sil
    try {
        await db.collection('automodrules').dropIndex('type_1');
        console.log("Eski type_1 indexi silindi");
    } catch(e) {
        console.log("type_1 index zaten yok veya silinemedi:", e.message);
    }
    
    // undefined kurali sil
    await db.collection('automodrules').deleteMany({ userId: "undefined" });
    console.log("undefined kural silindi");
    
    // 2keyyloops icin kural olustur
    await db.collection('automodrules').updateOne(
        { userId: "2keyyloops" },
        { $set: { userId: "2keyyloops", enabled: true, mode: "auto", bannedWordsEnabled: true, spamDetectionEnabled: true, emoteSpamEnabled: true, spamMaxRepeats: 3, emoteMaxRepeats: 3 } },
        { upsert: true }
    );
    console.log("2keyyloops kural olusturuldu");
    
    // lmmami06 icin kural olustur
    await db.collection('automodrules').updateOne(
        { userId: "lmmami06" },
        { $set: { userId: "lmmami06", enabled: true, mode: "auto", bannedWordsEnabled: true, spamDetectionEnabled: true, emoteSpamEnabled: true, spamMaxRepeats: 3, emoteMaxRepeats: 3 } },
        { upsert: true }
    );
    console.log("lmmami06 kural olusturuldu");
    
    // Dogrulama
    const all = await db.collection('automodrules').find({}).toArray();
    for (const r of all) {
        console.log(`  userId="${r.userId}" enabled=${r.enabled} mode=${r.mode}`);
    }
    
    process.exit(0);
}

fix();
