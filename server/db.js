const mongoose = require('mongoose');

// Schemas
const channelSchema = new mongoose.Schema({
    slug: { type: String, required: true },
    chatroomId: { type: String, required: true },
    userId: { type: String, default: '' },
    addedBy: { type: String, default: '' }
});

const wordSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    channel: { type: String, default: '' },
    word: { type: String, required: true },
    exactMatch: { type: Boolean, default: false },
    action: { type: String, default: 'ban' },
    duration: { type: Number, default: 0 },
    addedBy: { type: String, default: '' }
});

const automodRuleSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: true },
    mode: { type: String, default: 'auto' },
    bannedWordsEnabled: { type: Boolean, default: true },
    spamDetectionEnabled: { type: Boolean, default: true },
    linkBlockingEnabled: { type: Boolean, default: true },
    emoteSpamEnabled: { type: Boolean, default: true }
});

const visitorSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    kickId: { type: String },
    username: { type: String, required: true },
    email: { type: String },
    ip: { type: String, required: true },
    userAgent: { type: String },
    profilePic: { type: String },
    bio: { type: String },
    kickCreatedAt: { type: String },
    followers: { type: Number, default: 0 },
    lastLogin: { type: Date, default: Date.now },
    loginCount: { type: Number, default: 1 },
    accessToken: { type: String }, // NEW: Store access token for background moderation
    rawData: { type: Object }
});

const wordPresetSchema = new mongoose.Schema({
    shareCode: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
    words: { type: Array, required: true },
    createdAt: { type: Date, default: Date.now, expires: 604800 } // Preset expires in 7 days
});

// Models
const Channel = mongoose.model('Channel', channelSchema);
const Word = mongoose.model('Word', wordSchema);
const AutomodRule = mongoose.model('AutomodRule', automodRuleSchema);
const Visitor = mongoose.model('Visitor', visitorSchema);
const WordPreset = mongoose.model('WordPreset', wordPresetSchema);

async function connectDB() {
    if (!process.env.MONGODB_URI) {
        console.log('[MongoDB] Uyarı: MONGODB_URI bulunamadı, veritabanı kapalı olarak çalışıyor.');
        return false;
    }
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('[MongoDB] Veritabanına başarıyla bağlanıldı.');
        return true;
    } catch (err) {
        console.error('[MongoDB] Bağlantı hatası:', err);
        return false;
    }
}

module.exports = {
    connectDB,
    Channel,
    Word,
    AutomodRule,
    Visitor,
    WordPreset
};
