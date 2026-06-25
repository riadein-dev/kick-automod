const mongoose = require('mongoose');
require('dotenv').config();

const crossBanChannelSchema = new mongoose.Schema({
    slug: { type: String, required: true },
    chatroomId: { type: String, required: true },
    broadcasterUserId: { type: String },
    addedBy: { type: String, required: true }
});

const CrossBanChannel = mongoose.model('CrossBanChannel', crossBanChannelSchema);

async function check() {
    await mongoose.connect(process.env.MONGODB_URI);
    const channels = await CrossBanChannel.find();
    console.log("CHANNELS IN DB:", channels.length);
    for (let c of channels) {
        console.log(`- ${c.slug} | Broadcaster: ${c.broadcasterUserId}`);
    }
    process.exit(0);
}
check();
