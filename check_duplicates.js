const mongoose = require('mongoose');
const { Word } = require('./server/db');
require('dotenv').config();

async function run() {
    await mongoose.connect(process.env.MONGODB_URI);
    const words = await Word.find({ addedBy: 'dokess', word: 'sus' });
    console.log(`Found ${words.length} copies of sus_dokess`);
    for (const w of words) {
        console.log(`ID: ${w.id}, channel: ${w.channel}, action: ${w.action}`);
    }
    process.exit(0);
}
run();
