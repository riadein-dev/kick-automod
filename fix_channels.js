const mongoose = require('mongoose');
require('dotenv').config();
const { Channel } = require('./server/db');

async function fixChannels() {
    await mongoose.connect(process.env.MONGODB_URI);
    
    // Fix 2keyyloops channels: addedBy was "71070920" instead of "2keyyloops"
    const result1 = await Channel.updateMany(
        { addedBy: "71070920" }, 
        { $set: { addedBy: "2keyyloops" } }
    );
    console.log(`Fixed ${result1.modifiedCount} channels for 2keyyloops (71070920 -> 2keyyloops)`);
    
    // Fix lmmami06 channels: check if any were saved with numeric ID "38422341"
    const result2 = await Channel.updateMany(
        { addedBy: "38422341" }, 
        { $set: { addedBy: "lmmami06" } }
    );
    console.log(`Fixed ${result2.modifiedCount} channels for lmmami06 (38422341 -> lmmami06)`);
    
    // Also check AutomodRules with numeric IDs
    const { AutomodRule, Word } = require('./server/db');
    
    const result3 = await AutomodRule.updateMany(
        { ownerId: "71070920" },
        { $set: { ownerId: "2keyyloops" } }
    );
    console.log(`Fixed ${result3.modifiedCount} rules for 2keyyloops`);
    
    const result4 = await AutomodRule.updateMany(
        { ownerId: "38422341" },
        { $set: { ownerId: "lmmami06" } }
    );
    console.log(`Fixed ${result4.modifiedCount} rules for lmmami06`);
    
    const result5 = await Word.updateMany(
        { ownerId: "71070920" },
        { $set: { ownerId: "2keyyloops" } }
    );
    console.log(`Fixed ${result5.modifiedCount} words for 2keyyloops`);
    
    const result6 = await Word.updateMany(
        { ownerId: "38422341" },
        { $set: { ownerId: "lmmami06" } }
    );
    console.log(`Fixed ${result6.modifiedCount} words for lmmami06`);
    
    console.log("\nDone! All records fixed.");
    process.exit(0);
}

fixChannels();
