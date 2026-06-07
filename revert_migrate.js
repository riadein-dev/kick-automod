const mongoose = require('mongoose');
require('dotenv').config();
const { Word, AutomodRule } = require('./server/db');

async function revertMigrate() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Find all words owned by 'global', change ownerId back to 'Riadein'
    await Word.updateMany({ ownerId: 'global' }, { $set: { ownerId: 'Riadein' } });
    
    // Find all AutomodRules owned by 'global', change ownerId back to 'Riadein'
    await AutomodRule.updateMany({ ownerId: 'global' }, { $set: { ownerId: 'Riadein' } });

    console.log("Revert migration complete!");
    process.exit(0);
}

revertMigrate();
