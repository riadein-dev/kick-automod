const mongoose = require('mongoose');
require('dotenv').config();
const { Word } = require('./server/db');

async function dedupWords() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    const words = await Word.find({});
    const seen = new Map(); // key: "addedBy:word:action" -> first word id
    let deleted = 0;
    
    for (const w of words) {
        const key = `${w.addedBy}:${w.word}:${w.action}`;
        if (seen.has(key)) {
            await Word.deleteOne({ _id: w._id });
            deleted++;
        } else {
            seen.set(key, w.id);
        }
    }
    
    console.log(`${deleted} duplicate kelime silindi`);
    
    // Show final counts
    const remaining = await Word.find({});
    const counts = {};
    for (const w of remaining) {
        counts[w.addedBy] = (counts[w.addedBy] || 0) + 1;
    }
    console.log("Kelime sayilari:", counts);
    
    process.exit(0);
}
dedupWords();
