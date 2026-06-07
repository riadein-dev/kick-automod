const mongoose = require('mongoose');
require('dotenv').config();
const { Word, AutomodRule, Channel } = require('./server/db');

async function migrate() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Find all words, change ownerId to 'global'
    await Word.updateMany({}, { $set: { ownerId: 'global' } });
    
    // Find all AutomodRules, change ownerId to 'global'
    await AutomodRule.updateMany({}, { $set: { ownerId: 'global' } });

    console.log("Migration complete!");
    process.exit(0);
}

migrate();
