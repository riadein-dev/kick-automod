const mongoose = require('mongoose');
require('dotenv').config();

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    const rules = await mongoose.connection.db.collection('automodrules').find({userId: {$in: ['lmmami06', '2keyyloops', 'Riadein']}}).toArray();
    console.log(rules);
    process.exit(0);
});
