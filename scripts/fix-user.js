require('dotenv').config();
const mongoose = require('mongoose');

async function fix() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  
  // Fix all visitors that have logged in but hasAccess is not set
  // If they logged in, they likely used a code at some point
  const result = await db.collection('visitors').updateMany(
    { 
      hasAccess: { $ne: true },
      loginCount: { $gte: 1 },
      isBanned: { $ne: true }
    },
    { $set: { hasAccess: true } }
  );
  
  console.log(`Fixed ${result.modifiedCount} visitors (hasAccess set to true)`);
  
  // Also fix furkannrumiiQ specifically
  const furkan = await db.collection('visitors').findOne({ username: 'furkannrumiiQ' });
  if (furkan) {
    console.log(`\nfurkannrumiiQ status after fix:`);
    console.log(`  hasAccess: ${furkan.hasAccess}`);
  }
  
  // Show all visitors with hasAccess status
  const all = await db.collection('visitors').find({}).project({ username: 1, hasAccess: 1, loginCount: 1 }).toArray();
  console.log(`\nAll ${all.length} visitors hasAccess status:`);
  all.forEach(v => console.log(`  ${v.username}: hasAccess=${v.hasAccess}, logins=${v.loginCount}`));
  
  await mongoose.disconnect();
}

fix().catch(e => { console.error(e); process.exit(1); });
