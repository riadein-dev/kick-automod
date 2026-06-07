const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    const db = mongoose.connection.db;
    
    // Delete all invalid rules
    const r = await db.collection('automodrules').deleteMany({ 
        userId: { $nin: ["Riadein", "2keyyloops", "lmmami06", "dokess", "ilker4444", "AK2W", "ErenTurku"] }
    });
    console.log('silinen bozuk kural sayisi:', r.deletedCount);
    
    const all = await db.collection('automodrules').find({}).toArray();
    all.forEach(r => console.log(`  ${r.userId} | mode=${r.mode} | enabled=${r.enabled}`));
    
    process.exit(0);
});
