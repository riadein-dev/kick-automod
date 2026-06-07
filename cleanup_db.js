const mongoose = require('mongoose');
const { Word } = require('./server/db');
require('dotenv').config();

async function cleanup() {
    await mongoose.connect(process.env.MONGODB_URI);
    const words = await Word.find({});
    
    // Group by addedBy, word, channel, action
    const grouped = {};
    for (const w of words) {
        const key = `${w.addedBy}_${w.word.toLowerCase()}_${w.channel}_${w.action}`;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(w);
    }

    let deletedCount = 0;
    for (const [key, group] of Object.entries(grouped)) {
        if (group.length > 1) {
            // Keep the first one, delete the rest
            const toKeep = group[0];
            const toDelete = group.slice(1);
            for (const delWord of toDelete) {
                await Word.findByIdAndDelete(delWord._id);
                deletedCount++;
            }
            console.log(`Cleaned up duplicates for ${key}. Deleted ${toDelete.length} copies.`);
        }
    }
    
    console.log(`Cleanup complete. Deleted ${deletedCount} duplicates.`);
    process.exit(0);
}

cleanup();
