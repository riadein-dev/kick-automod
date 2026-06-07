const mongoose = require('mongoose');
const { Word } = require('./server/db');
require('dotenv').config();

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    const words = await Word.find({});
    console.log(`Total words in DB: ${words.length}`);
    const wordCounts = {};
    for (const w of words) {
        const key = w.word + '_' + w.addedBy;
        wordCounts[key] = (wordCounts[key] || 0) + 1;
    }
    for (const [key, count] of Object.entries(wordCounts)) {
        if (count > 1) {
            console.log(`Duplicate: ${key} -> ${count} times`);
        }
    }
    process.exit(0);
}
run();
