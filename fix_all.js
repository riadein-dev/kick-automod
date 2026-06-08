const mongoose = require('mongoose');
require('dotenv').config();
const { Channel, Word, Visitor } = require('./server/db');

async function fixAll() {
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    
    const visitors = await Visitor.find({});
    const idToName = {};
    for (const v of visitors) {
        if (v.kickId && v.username && /^\d+$/.test(String(v.kickId))) {
            idToName[String(v.kickId)] = v.username;
        }
    }
    
    for (const [numId, username] of Object.entries(idToName)) {
        // Channels & Words
        const r1 = await Channel.updateMany({ addedBy: numId }, { $set: { addedBy: username } });
        const r2 = await Word.updateMany({ addedBy: numId }, { $set: { addedBy: username } });
        // Rules: delete numeric if username already exists
        const existing = await db.collection('automodrules').findOne({ userId: username });
        if (existing) {
            await db.collection('automodrules').deleteMany({ userId: numId });
        } else {
            await db.collection('automodrules').updateMany({ userId: numId }, { $set: { userId: username } }).catch(() => {});
        }
        if (r1.modifiedCount || r2.modifiedCount) {
            console.log(`${numId} -> ${username}: ch=${r1.modifiedCount} w=${r2.modifiedCount}`);
        }
    }
    
    // Remove duplicate channels
    const channels = await Channel.find({});
    const seen = new Set();
    let dupes = 0;
    for (const c of channels) {
        const key = `${c.slug}:${c.addedBy}`;
        if (seen.has(key)) { await Channel.deleteOne({ _id: c._id }); dupes++; }
        else seen.add(key);
    }
    console.log(`Dupes removed: ${dupes}`);
    
    // Verify
    const final = await Channel.find({});
    const g = {};
    for (const c of final) { g[c.addedBy] = g[c.addedBy] || []; g[c.addedBy].push(c.slug); }
    console.log("Channels:", JSON.stringify(g));
    
    const rules = await db.collection('automodrules').find({}).toArray();
    console.log("Rules:", rules.map(r => r.userId));
    
    process.exit(0);
}
fixAll();
