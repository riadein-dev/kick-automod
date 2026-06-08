const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    await mongoose.connection.db.collection('automodrules').updateOne({userId: 'lmmami06'}, { $set: { enabled: true } });
    console.log('lmmami06 enabled');
    process.exit(0);
});
