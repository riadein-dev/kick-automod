const mongoose = require('mongoose');
require('dotenv').config();
const { Channel, Word, AutomodRule } = require('./server/db');

async function diagnoseAndFix() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log("=== KANAL DURUMU ===");
    const channels = await Channel.find({});
    const grouped = {};
    for (const c of channels) {
        const key = c.addedBy || '(bos)';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(c.slug);
    }
    for (const [user, slugs] of Object.entries(grouped)) {
        console.log(`  ${user}: ${[...new Set(slugs)].join(', ')}`);
    }
    
    console.log("\n=== AUTOMOD KURAL DURUMU ===");
    const rules = await AutomodRule.find({});
    for (const r of rules) {
        console.log(`  userId="${r.userId}" enabled=${r.enabled} mode=${r.mode} bannedWords=${r.bannedWordsEnabled} spam=${r.spamDetectionEnabled}`);
    }
    
    console.log("\n=== KELIME DURUMU ===");
    const words = await Word.find({});
    const wordGroups = {};
    for (const w of words) {
        const key = w.addedBy || '(bos)';
        if (!wordGroups[key]) wordGroups[key] = 0;
        wordGroups[key]++;
    }
    for (const [user, count] of Object.entries(wordGroups)) {
        console.log(`  ${user}: ${count} kelime`);
    }
    
    console.log("\n=== DUZELTME YAPILIYOR ===");
    
    // Fix AutomodRule: userId alanini duzelt (onceki script yanlis ownerId kullanmisti)
    const r1 = await AutomodRule.updateMany({ userId: "71070920" }, { $set: { userId: "2keyyloops" } });
    console.log(`AutomodRule 71070920 -> 2keyyloops: ${r1.modifiedCount} duzeltildi`);
    
    const r2 = await AutomodRule.updateMany({ userId: "38422341" }, { $set: { userId: "lmmami06" } });
    console.log(`AutomodRule 38422341 -> lmmami06: ${r2.modifiedCount} duzeltildi`);
    
    // Fix Word: addedBy alanini duzelt (onceki script yanlis ownerId kullanmisti)
    const r3 = await Word.updateMany({ addedBy: "71070920" }, { $set: { addedBy: "2keyyloops" } });
    console.log(`Word 71070920 -> 2keyyloops: ${r3.modifiedCount} duzeltildi`);
    
    const r4 = await Word.updateMany({ addedBy: "38422341" }, { $set: { addedBy: "lmmami06" } });
    console.log(`Word 38422341 -> lmmami06: ${r4.modifiedCount} duzeltildi`);
    
    // Fix Channel: addedBy alanini duzelt (bunu zaten yapmistik ama tekrar kontrol)
    const r5 = await Channel.updateMany({ addedBy: "71070920" }, { $set: { addedBy: "2keyyloops" } });
    console.log(`Channel 71070920 -> 2keyyloops: ${r5.modifiedCount} duzeltildi`);
    
    const r6 = await Channel.updateMany({ addedBy: "38422341" }, { $set: { addedBy: "lmmami06" } });
    console.log(`Channel 38422341 -> lmmami06: ${r6.modifiedCount} duzeltildi`);
    
    console.log("\n=== DUZELTME SONRASI DURUM ===");
    const rulesAfter = await AutomodRule.find({});
    for (const r of rulesAfter) {
        console.log(`  userId="${r.userId}" enabled=${r.enabled} mode=${r.mode}`);
    }
    const wordsAfter = await Word.find({});
    const wgAfter = {};
    for (const w of wordsAfter) {
        const key = w.addedBy || '(bos)';
        if (!wgAfter[key]) wgAfter[key] = 0;
        wgAfter[key]++;
    }
    for (const [user, count] of Object.entries(wgAfter)) {
        console.log(`  ${user}: ${count} kelime`);
    }
    
    console.log("\nTamamlandi!");
    process.exit(0);
}

diagnoseAndFix();
