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
    emoteSpamEnabled: { type: Boolean, default: true },
    spamMaxRepeats: { type: Number, default: 3 },
    emoteMaxRepeats: { type: Number, default: 3 }
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
    accessToken: { type: String }, // Store access token for background moderation
    refreshToken: { type: String }, // Refresh token for auto-renewal
    tokenExpiry: { type: Number }, // Token expiry timestamp (ms)
    rawData: { type: Object },
    isBanned: { type: Boolean, default: false },
    hasAccess: { type: Boolean, default: false }, // Access code tracking
    isAdmin: { type: Boolean, default: false } // NEW: Admin flag
});

const inviteCodeSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    createdBy: { type: String, required: true },
    used: { type: Boolean, default: false },
    usedBy: { type: String },
    createdAt: { type: Date, default: Date.now }
});

const wordPresetSchema = new mongoose.Schema({
    shareCode: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
    words: { type: Array, required: true },
    createdAt: { type: Date, default: Date.now, expires: 604800 } // Preset expires in 7 days
});

// Chat history buffer schema (to survive server restarts)
const chatMessageSchema = new mongoose.Schema({
    channelSlug: { type: String, required: true, index: true },
    messageId: { type: String, required: true },
    content: { type: String, required: true },
    username: { type: String },
    userId: { type: Number },
    timestamp: { type: String },
    sender: { type: Object },
    createdAt: { type: Date, default: Date.now, expires: 604800 } // Messages expire after 1 week
});

const moderationLogSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    channel: { type: String, required: true },
    chatroomId: { type: String },
    userId: { type: String, required: true },
    messageId: { type: String, required: true },
    username: { type: String, required: true },
    messageContent: { type: String },
    ruleName: { type: String, required: true },
    reason: { type: String },
    type: { type: String, default: 'auto' }, // auto veya manual
    action: { type: String }, // delete, timeout, ban
    duration: { type: Number }, // timeout duration
    status: { type: String, default: 'pending' }, // pending, applied, rejected, unbanned, error
    ownerId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, expires: 604800 } // Moderation logs expire in 1 week
});

// Models
const Channel = mongoose.model('Channel', channelSchema);
const Word = mongoose.model('Word', wordSchema);
const AutomodRule = mongoose.model('AutomodRule', automodRuleSchema);
const Visitor = mongoose.model('Visitor', visitorSchema);
const WordPreset = mongoose.model('WordPreset', wordPresetSchema);
const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
const ModerationLog = mongoose.model('ModerationLog', moderationLogSchema);
const InviteCode = mongoose.model('InviteCode', inviteCodeSchema);

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
    ChatMessage,
    ModerationLog,
    Visitor,
    WordPreset,
    InviteCode
};
