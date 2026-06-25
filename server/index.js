/**
 * Kick AutoMod Dashboard - Main Server
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);

// Override console to log to file
const logStream = fs.createWriteStream(path.join(__dirname, '..', 'backend.log'), { flags: 'a' });
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

function formatArgs(args) {
    return args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
}

console.log = function(...args) {
    const msg = `[LOG] ${new Date().toISOString()} - ${formatArgs(args)}\n`;
    logStream.write(msg);
    originalConsoleLog.apply(console, args);
};
console.error = function(...args) {
    const msg = `[ERR] ${new Date().toISOString()} - ${formatArgs(args)}\n`;
    logStream.write(msg);
    originalConsoleError.apply(console, args);
};
console.warn = function(...args) {
    const msg = `[WARN] ${new Date().toISOString()} - ${formatArgs(args)}\n`;
    logStream.write(msg);
    originalConsoleWarn.apply(console, args);
};

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

const auth = require('./auth');
const store = require('./store');
const { createKickClient } = require('./kickApi');
const wsManager = require('./websocket');
const automod = require('./automod');

// Güvenlik Kütüphaneleri
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const xss = require('xss-clean');
const hpp = require('hpp');
const csurf = require('csurf');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// IP/User Ban Check Middleware
app.use((req, res, next) => {
    // Check IP
    const clientIp = req.ip || req.connection.remoteAddress;
    if (store.isIpBanned(clientIp)) {
        return res.status(403).send('Erişiminiz sistem yöneticisi tarafından engellendi.');
    }
    
    // Check Session User
    if (req.session && req.session.user && req.session.user.raw && req.session.user.raw.id) {
        if (store.isUserBanned(req.session.user.raw.id)) {
            req.session.destroy();
            return res.status(403).send('Hesabınız sistemden uzaklaştırıldı.');
        }
    }
    next();
});

// --- GÜVENLİK KATMANI (SECURITY MIDDLEWARE) ---
// 1. HTTP Başlıklarını Koru
app.use(helmet({
  contentSecurityPolicy: false // Mevcut arayüzü bozmamak için
}));

// 2. CORS Koruması (Dışarıdan API kullanımını engelle)
app.use(cors({
  origin: true, // Aynı domainden gelen isteklere izin ver
  credentials: true
}));

// 3. DDoS ve Brute-Force Koruması (Hız Sınırı)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 500, // Her IP için 500 istek limiti (normal kullanım için bolca yeterli)
  message: { error: 'Çok fazla istek gönderdiniz, sistem güvenliği için lütfen 15 dakika bekleyin.' }
});
app.use('/api', globalLimiter); 

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 30, // Giriş rotaları için daha sıkı limit
  message: { error: 'Çok fazla giriş denemesi, lütfen daha sonra tekrar deneyin.' }
});
app.use('/auth', authLimiter);

// 4. Zararlı kod (XSS) enjeksiyonlarını temizle
app.use(xss());

// 5. HTTP Parametre Kirliliğini engelle
app.use(hpp());

// 6. CSRF Koruması
const csrfProtection = csurf({ cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production' } });
// ----------------------------------------------

// Session
app.set('trust proxy', 1); // Trust Render's proxy for secure cookies
app.use(session({
  store: new FileStore({ path: './sessions', logFn: function(){} }),
  secret: process.env.SESSION_SECRET || 'kick-automod-secret-fallback',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
  }
}));

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));

const { connectDB } = require('./db');

// Start Server Logic
async function startServer() {
    await connectDB();
    await store.loadFromDB();
    
    // Initialize WebSocket Manager after loading channels
    wsManager.connect();
    
    // Start automatic token refresh (refreshes all expired tokens on startup + every 30 min)
    automod.startTokenRefreshInterval();
    
    // Setup Routes
app.use('/auth', auth.router);

// API Routes (Require Authentication)
const apiRouter = express.Router();

// Apply CSRF to all API routes except SSE stream
// SSE stream uses GET and we don't strictly need CSRF there, but we apply it to everything mutating
apiRouter.use(auth.requireAuth);
apiRouter.use(csrfProtection);

// Endpoint for frontend to fetch CSRF token
apiRouter.get('/csrf-token', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// Middleware to ensure automod has access token for API calls
apiRouter.use((req, res, next) => {
    if (req.session && req.session.accessToken) {
      automod.setAccessToken(req.session.accessToken);
      const currentUserId = req.session.userId || (req.session.user && req.session.user.raw && req.session.user.raw.id) || null;
      if (currentUserId) {
          automod.setAdminUserId(currentUserId);
          store.touchUser(currentUserId); // Track activity for online status
      }
    }
    next();
  });

// Admin check middleware
const adminOnly = (req, res, next) => {
    if (!req.session.isAdmin) {
        return res.status(403).json({ error: 'Bu işlem için yetkiniz yok.' });
    }
    next();
};

// Invite Codes Routes (Admin Only)
apiRouter.get('/invite-codes', adminOnly, async (req, res) => {
    const { InviteCode } = require('./db');
    try {
        const codes = await InviteCode.find().sort({ createdAt: -1 });
        res.json(codes);
    } catch (e) {
        res.status(500).json({ error: 'Kodlar getirilemedi.' });
    }
});

apiRouter.post('/invite-codes', adminOnly, async (req, res) => {
    const { InviteCode } = require('./db');
    try {
        const crypto = require('crypto');
        const code = 'INV-' + crypto.randomBytes(4).toString('hex').toUpperCase();
        const newCode = await InviteCode.create({
            code: code,
            createdBy: req.session.userId
        });
        res.json(newCode);
    } catch (e) {
        res.status(500).json({ error: 'Kod oluşturulamadı.' });
    }
});

apiRouter.delete('/invite-codes/:id', adminOnly, async (req, res) => {
    const { InviteCode } = require('./db');
    try {
        await InviteCode.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Kod silinemedi.' });
    }
});

// Multer Setup for Cross Ban image uploads
const multer = require('multer');
const uploadStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/uploads/'));
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: uploadStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Sadece resim dosyaları yüklenebilir.'));
    }
});

// Cross Ban API Routes
apiRouter.get('/crossban/channels', adminOnly, async (req, res) => {
    const { CrossBanChannel } = require('./db');
    try {
        const channels = await CrossBanChannel.find();
        res.json(channels);
    } catch (e) {
        res.status(500).json({ error: 'Cross Ban kanalları getirilemedi.' });
    }
});

apiRouter.post('/crossban/channels', adminOnly, async (req, res) => {
    const { CrossBanChannel } = require('./db');
    const { slug } = req.body;
    if (!slug) return res.status(400).json({ error: 'Kanal adı gerekli.' });
    
    try {
        // Resolve Kick ChatroomId
        const kickRes = await fetch(`https://kick.com/api/v2/channels/${slug}`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        if (!kickRes.ok) return res.status(404).json({ error: 'Kanal bulunamadı veya Kick API hatası. HTTP: ' + kickRes.status });
        
        const data = await kickRes.json();
        if (!data || !data.chatroom || !data.chatroom.id) return res.status(404).json({ error: 'Sohbet odası ID bulunamadı.' });
        
        const newChannel = await CrossBanChannel.create({
            slug: slug,
            chatroomId: data.chatroom.id.toString(),
            broadcasterUserId: data.user_id?.toString() || '',
            addedBy: req.session.userId || 'Bilinmiyor'
        });
        res.json(newChannel);
    } catch (e) {
        console.error('Cross ban channel error:', e);
        res.status(500).json({ error: 'Kanal eklenemedi: ' + e.message });
    }
});

apiRouter.delete('/crossban/channels/:id', adminOnly, async (req, res) => {
    const { CrossBanChannel } = require('./db');
    try {
        await CrossBanChannel.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Kanal silinemedi.' });
    }
});

apiRouter.get('/crossban/logs', adminOnly, async (req, res) => {
    const { CrossBanLog } = require('./db');
    try {
        const logs = await CrossBanLog.find().sort({ createdAt: -1 }).limit(100);
        res.json(logs);
    } catch (e) {
        res.status(500).json({ error: 'Geçmiş getirilemedi.' });
    }
});

// Using multiple middlewares: auth, adminOnly, and multer upload
apiRouter.post('/crossban/action', adminOnly, upload.single('image'), async (req, res) => {
    const { CrossBanChannel, CrossBanLog } = require('./db');
    const { username, action, duration, reason } = req.body;
    const imageUrl = req.file ? `/uploads/${req.file.filename}` : '';

    if (!username || !action) return res.status(400).json({ error: 'Eksik parametreler.' });

    try {
        // 1. Resolve Kick User ID from Username
        const kickRes = await fetch(`https://kick.com/api/v2/channels/${username}`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        let targetUserId = null;
        if (kickRes.ok) {
            const data = await kickRes.json();
            if (data && data.user_id) targetUserId = data.user_id.toString();
        }

        if (!targetUserId) {
            return res.status(404).json({ error: 'Kullanıcı ID tespit edilemedi. Nick yanlış olabilir.' });
        }

        // 2. Log it
        const log = await CrossBanLog.create({
            username: username,
            userId: targetUserId,
            action: action,
            duration: duration ? parseInt(duration) : null,
            reason: reason || '',
            imageUrl: imageUrl,
            addedBy: req.session.userId
        });

        // 3. Execute action on all crossban channels
        const channels = await CrossBanChannel.find();
        
        // Asynchronously perform actions
        setTimeout(async () => {
            const callerNumericId = req.session.kickNumericId || '';
            for (let i = 0; i < channels.length; i++) {
                const ch = channels[i];
                try {
                    // Kick API needs broadcasterUserId, not chatroomId for these endpoints
                    if (action === 'ban') {
                        await automod.client.banUser(ch.broadcasterUserId, targetUserId, reason || 'Cross Ban', callerNumericId);
                    } else if (action === 'timeout') {
                        await automod.client.timeoutUser(ch.broadcasterUserId, targetUserId, parseInt(duration) || 5, reason || 'Cross Timeout', callerNumericId);
                    } else if (action === 'unban') {
                        await automod.client.unbanUser(ch.broadcasterUserId, targetUserId, callerNumericId);
                    }
                } catch(err) {
                    console.error(`CrossBan error on channel ${ch.slug} for ${username}:`, err.message);
                }
                // Delay 500ms between each channel
                await new Promise(r => setTimeout(r, 500));
            }
        }, 100);

        res.json({ success: true, log: log });
    } catch (e) {
        console.error('Cross ban action error:', e);
        res.status(500).json({ error: 'İşlem sırasında hata oluştu.' });
    }
});

// Dashboard stats
apiRouter.get('/stats', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const rules = store.getAutomodRules(sessionUserId);

  res.json({
    stats: store.getUserStats(sessionUserId),
    wsStatus: wsManager.getStatus(),
    automodRules: rules
  });
});

// Moderation logs
apiRouter.get('/moderation', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  
  // Only show logs that were generated by this user's rules or manual actions
  const allLogs = store.getModerationLogs(req.query);
  const logs = allLogs.filter(log => log.ownerId === sessionUserId);
  res.json(logs);
});

// Clear all moderation logs
apiRouter.delete('/logs', (req, res) => {
  store.clearModerationLogs();
  res.json({ success: true });
});

// Update moderation log status (approve/reject/etc)
apiRouter.patch('/moderation/:id', async (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const { id } = req.params;
  const { status, action, duration } = req.body;
  
  const existingLog = store.getModerationLogs().find(l => l.id === id);
  if (!existingLog) {
    return res.status(404).json({ error: 'Log not found' });
  }
  
  if (existingLog.ownerId !== sessionUserId) {
    return res.status(403).json({ error: 'Unauthorized to modify this log' });
  }

  const updates = { status };
  if (action) updates.action = action;
  if (duration !== undefined) updates.duration = duration;

  const log = store.updateModerationLog(id, updates);

  // Eğer bir spam log'u "Yok Say" (rejected) yapıldıysa, aynı kullanıcının diğer pending spam log'larını da reject et
  if (existingLog.ruleName === 'spamDetection' && status === 'rejected') {
      const allLogs = store.getModerationLogs();
      const otherLogs = allLogs.filter(l => 
          l.ruleName === 'spamDetection' && 
          l.userId === existingLog.userId && 
          l.status === 'pending' &&
          l.id !== id
      );
      for (const ol of otherLogs) {
          store.updateModerationLog(ol.id, { status: 'rejected' });
      }
  }

  // If approved and action requested, execute it via Kick API
  if ((status === 'applied' || status === 'unbanned') && action && req.session.accessToken) {
    try {
      const kickClient = createKickClient(req.session.accessToken);
      
      const channels = store.getChannels();
      const channel = channels.find(c => 
        String(c.id) === String(log.chatroomId) || 
        String(c.chatroomId) === String(log.chatroomId) ||
        c.slug === log.channel
      );
      const broadcasterUserId = channel ? (channel.broadcasterUserId || channel.userId) : null;
      
      console.log(`[ModAction] channel found: ${!!channel}, broadcasterUserId: ${broadcasterUserId}, action: ${action}, userId: ${log.userId}`);
      
      if (!broadcasterUserId && action !== 'delete') {
        throw new Error("Broadcaster User ID not found for this channel");
      }
      
      if (action === 'delete') {
          await kickClient.deleteMessage(log.messageId);
        } else if (action === 'timeout') {
          await kickClient.timeoutUser(broadcasterUserId, log.userId, log.duration || 5, log.reason, req.session.kickNumericId);
        } else if (action === 'ban') {
          await kickClient.banUser(broadcasterUserId, log.userId, log.reason, req.session.kickNumericId);
        } else if (action === 'unban') {
          console.log(`[ModAction] Attempting UNBAN: broadcaster=${broadcasterUserId}, targetUser=${log.userId}, caller=${req.session.kickNumericId}`);
          await kickClient.unbanUser(broadcasterUserId, log.userId, req.session.kickNumericId);
        }
      
      console.log(`[ModAction] ✅ ${action} applied successfully on user ${log.userId} by caller ${req.session.userId}`);
    } catch (err) {
      console.error(`[ModAction] ❌ Failed to apply moderation action '${action}' for caller ${req.session.userId}:`, err);
      store.updateModerationLog(id, { status: 'error', error: err.message });
      return res.status(500).json({ error: `Kick API Hatası: ${err.message}`, details: err.message });
    }
  }

  res.json(log);
});

// Direct manual action (from Chat Kontrol)
apiRouter.post('/manual-mod', async (req, res) => {
  const { action, userId, messageId, duration, channelSlug, reason, username, messageContent } = req.body;
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  
  if (!req.session.accessToken) {
      return res.status(401).json({ error: 'Unauthorized: No access token' });
  }

  try {
      const kickClient = createKickClient(req.session.accessToken);
      const channels = store.getChannels();
      let channel = channels.find(c => c.slug === channelSlug && c.addedBy === sessionUserId);
      
      if (!channel) {
          return res.status(403).json({ error: 'You are not authorized to moderate this channel' });
      }

      let chatroomId = channel.chatroomId;
      let broadcasterUserId = channel.broadcasterUserId || channel.userId;

      // Robust fallback: if any ID is missing, fetch directly from Kick API
      if (!chatroomId || (!broadcasterUserId && action !== 'delete')) {
          const channelData = await kickClient.getChannel(channelSlug);
          if (channelData) {
              if (!chatroomId && channelData.chatroom) chatroomId = channelData.chatroom.id;
              if (!broadcasterUserId) broadcasterUserId = channelData.user_id;
          }
      }

      if (!broadcasterUserId && action !== 'delete') {
          throw new Error("Broadcaster User ID not found for this channel or you don't have access to this channel.");
      }

        if (action === 'delete') {
            if (messageId) {
                await kickClient.deleteMessage(messageId);
            } else {
                throw new Error("Message ID is required for delete action");
            }
        } else if (action === 'timeout') {
            try {
                await kickClient.timeoutUser(broadcasterUserId, userId, duration || 5, reason || 'Manuel moderasyon', req.session.kickNumericId);
            } catch (err) {
                if (err.message.includes('401') || err.message.includes('Unauthorized')) {
                    console.log(`[ModAction] Timeout API yetkisiz (401), sohbet komutu deneniyor... (${username})`);
                    await kickClient.sendMessage(chatroomId, `/timeout ${username} ${duration || 5} ${reason || 'Manuel moderasyon'}`);
                } else {
                    throw err;
                }
            }
            if (messageId && chatroomId) {
               await kickClient.deleteMessage(messageId).catch(() => {});
            }
        } else if (action === 'ban') {
            try {
                await kickClient.banUser(broadcasterUserId, userId, reason || 'Manuel moderasyon', req.session.kickNumericId);
            } catch (err) {
                if (err.message.includes('401') || err.message.includes('Unauthorized')) {
                    console.log(`[ModAction] Ban API yetkisiz (401), sohbet komutu deneniyor... (${username})`);
                    await kickClient.sendMessage(chatroomId, `/ban ${username} ${reason || 'Manuel moderasyon'}`);
                } else {
                    throw err;
                }
            }
        } else if (action === 'unban') {
            try {
                await kickClient.unbanUser(broadcasterUserId, userId, req.session.kickNumericId);
            } catch (err) {
                if (err.message.includes('401') || err.message.includes('Unauthorized')) {
                    console.log(`[ModAction] Unban API yetkisiz (401), sohbet komutu deneniyor... (${username})`);
                    await kickClient.sendMessage(chatroomId, `/unban ${username}`);
                } else {
                    throw err;
                }
            }
        }

      // Check if an AutoMod log already exists for this message
      const existingLogs = store.getModerationLogs().filter(l => l.messageId === messageId && l.userId === userId);
      
      if (existingLogs.length > 0) {
          // Update the existing log(s) instead of creating duplicates
          for (const log of existingLogs) {
              store.updateModerationLog(log.id, {
                  action: action,
                  duration: duration || 0,
                  status: 'applied',
                  type: 'manual'
              });
          }
      } else {
          // Record this manual action to moderation logs so it shows in the UI
          store.addModerationLog({
              channel: channelSlug,
              userId: userId,
              messageId: messageId,
              username: username || 'Bilinmiyor',
              messageContent: messageContent || 'Manuel işlem uygulandı',
              ruleName: 'manualAction',
              reason: reason || 'Chat üzerinden manuel işlem',
              type: 'manual',
              action: action,
              duration: duration || 0,
              status: 'applied',
              ownerId: sessionUserId
          });
      }

      res.json({ success: true });
  } catch (err) {
      console.error(`[ManualAction] Error:`, err);
      res.status(500).json({ error: err.message });
  }
});

// Chat Send Message
apiRouter.post('/chat/send', async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const { chatroomId, content, channelSlug } = req.body;
    if (!content) return res.status(400).json({ error: 'Missing content' });
    
    try {
        const kickClient = await automod._getClient(userId);
        if (!kickClient) return res.status(401).json({ error: 'Kick token not available' });
        
        // Find broadcaster user ID from channel data
        const channels = store.getChannels();
        const channel = channels.find(c => 
            (String(c.chatroomId) === String(chatroomId) || 
            String(c.id) === String(chatroomId) ||
            c.slug === channelSlug) && c.addedBy === userId
        );
        
        if (!channel) {
            return res.status(403).json({ error: 'You are not authorized to send messages to this channel' });
        }
        
        const broadcasterUserId = channel.broadcasterUserId || channel.userId;
        
        await kickClient.sendMessage(parseInt(chatroomId), content, broadcasterUserId);
        res.json({ ok: true });
    } catch (err) {
        console.error('[API] Chat send error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Chat History (load previous messages)
apiRouter.get('/chat/history', async (req, res) => {
    const channel = req.query.channel;
    if (!channel) return res.status(400).json({ error: 'Missing channel' });
    
    // Geçmiş mesajlar artık sunucu kapanıp açılsa bile MongoDB'den Store'a yüklendiği için her zaman dolu gelecek
    let history = store.getChatHistory(channel, 500);
    
    // Arkadaşının sitesindeki gibi "eski mesajları direkt çekmeyi" deniyoruz.
    // Eğer sunucu IP'si Cloudflare'e takılmazsa çalışır, takılırsa MongoDB'deki history'yi gösterir.
    if (history.length < 50) {
        try {
            const dummyClient = createKickClient(null);
            const recent = await dummyClient.getRecentMessages(channel);
            if (recent && recent.length > 0) {
                const mappedRecent = recent.map(msg => ({
                    id: msg.id,
                    content: msg.content,
                    username: msg.sender?.username,
                    user_id: msg.sender?.id,
                    timestamp: msg.created_at,
                    sender: msg.sender
                }));
                
                const existingIds = new Set(history.map(m => m.id));
                const newMessages = mappedRecent.filter(m => !existingIds.has(m.id));
                newMessages.forEach(m => store.addChatMessage(channel, m));
                history = store.getChatHistory(channel, 500);
            }
        } catch (e) {
            console.error('[API] Failed to fetch recent messages:', e.message);
        }
    }
    
    res.json(history);
});

// User Settings (per-user, server-side persistence)
apiRouter.get('/user-settings', (req, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const settings = store.getUserSettings(userId);
    res.json(settings || {});
});

apiRouter.patch('/user-settings', (req, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const updates = req.body;
    store.updateUserSettings(userId, updates);
    res.json({ ok: true });
});

// Channels management
apiRouter.get('/channels', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const allChannels = store.getChannels();
  const userChannels = allChannels.filter(c => c.addedBy === sessionUserId);
  res.json(userChannels);
});

// Clear only THIS user's channels on login
apiRouter.delete('/channels/all', async (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  console.log(`[Channels] Clearing channels for user: ${sessionUserId}`);
  const allChannels = store.getChannels();
  const userChannels = allChannels.filter(c => c.addedBy === sessionUserId);
  
  // Remove only this user's channels from store
  store.channels = allChannels.filter(c => c.addedBy !== sessionUserId);
  
  for (const ch of userChannels) {
    const chatroomId = String(ch.id || ch.chatroomId);
    // Check if anyone else is still using this channel
    const otherUsersChannel = store.channels.find(c => String(c.id || c.chatroomId) === chatroomId);
    if (!otherUsersChannel) {
        wsManager.unsubscribeFromChannel(chatroomId);
    }
  }
  
  store.stats.activeChannels = store.channels.filter(c => c.active).length;
  res.json({ success: true });
});

apiRouter.post('/channels', async (req, res) => {
  const { slug, chatroomId, userId } = req.body;
  if (!slug) return res.status(400).json({ error: 'Channel slug required' });

  try {
    const kickClient = createKickClient(req.session.accessToken);
    automod.setAccessToken(req.session.accessToken);

    let finalChatroomId = chatroomId;
    let finalUserId = userId;

    if (!finalChatroomId || !finalUserId) {
        // First, check if the user is adding their own channel
        if (req.session.user && req.session.user.slug && slug === req.session.user.slug.toLowerCase()) {
             if (!finalUserId) finalUserId = req.session.user.id;
        }
        
        // If still missing something, try Kick API
        if (!finalChatroomId || !finalUserId) {
            const channelData = await kickClient.getChannel(slug);
            if (channelData) {
                if (!finalChatroomId && channelData.chatroom) finalChatroomId = channelData.chatroom.id;
                if (!finalUserId) finalUserId = channelData.user_id || null;
            } else if (!finalChatroomId) {
                return res.status(404).json({ error: 'Channel or chatroom not found. Please use Advanced Options.' });
            }
        }
    }

    // Tag channel with the user who added it
    const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
    const success = wsManager.subscribeToChannel(finalChatroomId, slug, finalUserId, sessionUserId);
    if (!success) {
      return res.status(500).json({ error: 'Failed to subscribe to chat' });
    }

    res.json({ success: true, chatroomId: finalChatroomId, slug });
  } catch (err) {
    console.error('Add channel error:', err);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/channels/:id', (req, res) => {
  const { id } = req.params;
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  console.log(`[Channels] Removing channel: ${id} for user ${sessionUserId}`);
  
  const channels = store.getChannels();
  const channel = channels.find(c => 
    (String(c.id) === String(id) || 
    String(c.chatroomId) === String(id) ||
    c.slug === id) && c.addedBy === sessionUserId
  );
  
  if (channel) {
    const chatroomId = String(channel.id || channel.chatroomId);
    store.removeChannel(channel.slug, sessionUserId);
    
    // Check if anyone else is still using this channel
    const otherUsersChannel = store.getChannels().find(c => String(c.id || c.chatroomId) === chatroomId);
    if (!otherUsersChannel) {
        wsManager.unsubscribeFromChannel(chatroomId);
        console.log(`[Channels] ✅ Unsubscribed from channel: ${channel.slug} (${chatroomId}) globally`);
    } else {
        console.log(`[Channels] ✅ Removed channel for user ${sessionUserId}, but kept globally for others.`);
    }
    
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Channel not found' });
  }
});

// Rules management
apiRouter.get('/rules', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const rules = store.getAutomodRules(sessionUserId);
  res.json(rules);
});

apiRouter.patch('/rules', async (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const updates = req.body;
  const oldMode = store.getAutomodRules(sessionUserId).mode;
  const result = store.updateAutomodRules(sessionUserId, updates);
  
  // If switching from manual to auto, apply retroactive timeouts
  if (oldMode === 'manual' && updates.mode === 'auto') {
    try {
      const kickClient = createKickClient(req.session.accessToken);
      const pendingSpamLogs = store.getModerationLogs({ ownerId: sessionUserId }).filter(l => l.ruleName === 'spamDetection' && l.status === 'pending');
      const channels = store.getChannels();
      
      for (const log of pendingSpamLogs) {
        const channel = channels.find(c => 
          String(c.id) === String(log.chatroomId) || 
          String(c.chatroomId) === String(log.chatroomId) ||
          c.slug === log.channel
        );
          const broadcasterUserId = channel ? (channel.broadcasterUserId || channel.userId) : null;
          if (broadcasterUserId) {
            await kickClient.timeoutUser(broadcasterUserId, log.userId, log.duration || 5, log.reason, sessionUserId);
            store.updateModerationLog(log.id, { status: 'applied', action: 'timeout', duration: log.duration || 5 });
          }
      }
    } catch (e) {
      console.error('Failed to apply retroactive auto-timeouts:', e);
    }
  }
  
  res.json(result);
});

apiRouter.patch('/rules/:ruleName', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const { ruleName } = req.params;
  res.json(store.updateRule(sessionUserId, ruleName, req.body));
});

// Custom Words Management
apiRouter.post('/words', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const wordData = req.body;

  // Check for exact duplicates to prevent double-click bugs
  const currentRules = store.getAutomodRules(sessionUserId);
  const exists = currentRules.rules.bannedWords.words.find(w => 
    w.word.toLowerCase() === wordData.word.toLowerCase() && 
    w.exactMatch === (wordData.exactMatch || false)
  );
  
  if (exists) {
      return res.json(exists);
  }

  const word = store.addCustomWord(sessionUserId, wordData);
  res.json(word);
});

apiRouter.delete('/words/:id', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  store.removeCustomWord(sessionUserId, req.params.id);
  res.json({ success: true });
});

apiRouter.delete('/words', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  store.removeAllCustomWords(sessionUserId);
  res.json({ success: true });
});

apiRouter.patch('/words/:id', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const { enabled } = req.body;
  const word = store.toggleCustomWord(sessionUserId, req.params.id, enabled);
  if (word) {
      res.json(word);
  } else {
      res.status(404).json({ error: 'Kelime bulunamadı' });
  }
});

// Word Preset Sharing
apiRouter.post('/words/share', async (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const rules = store.getAutomodRules(sessionUserId);
  const words = rules.rules.bannedWords.words || [];
  
  if (words.length === 0) {
      return res.status(400).json({ error: 'Paylaşılacak kelime bulunamadı.' });
  }

  // Generate a random 5-character alphanumeric code
  const shareCode = Math.random().toString(36).substring(2, 7).toUpperCase();
  
  if (process.env.MONGODB_URI) {
      const { WordPreset } = require('./db');
      try {
          await WordPreset.create({
              shareCode,
              ownerId: sessionUserId,
              words: words.map(w => ({
                  word: w.word,
                  exactMatch: w.exactMatch,
                  action: w.action,
                  duration: w.duration
              }))
          });
      } catch (err) {
          console.error('[WordPreset] Paylaşım kodu oluşturulamadı:', err);
          return res.status(500).json({ error: 'Paylaşım kodu oluşturulamadı.' });
      }
  } else {
      return res.status(500).json({ error: 'Veritabanı bağlı değil, paylaşım özelliği kullanılamaz.' });
  }

  res.json({ success: true, shareCode });
});

apiRouter.post('/words/import', async (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  let { shareCode } = req.body;
  
  if (!shareCode) return res.status(400).json({ error: 'Paylaşım kodu gerekli.' });
  shareCode = shareCode.toUpperCase().trim();

  if (!process.env.MONGODB_URI) {
      return res.status(500).json({ error: 'Veritabanı bağlı değil.' });
  }

  const { WordPreset } = require('./db');
  try {
      const preset = await WordPreset.findOne({ shareCode });
      if (!preset) {
          return res.status(404).json({ error: 'Geçersiz veya süresi dolmuş kod.' });
      }

      const rules = store.getAutomodRules(sessionUserId);
      const currentWords = rules.rules.bannedWords.words || [];
      let importedCount = 0;

      for (const w of preset.words) {
          // Check if word already exists with the exact same settings
          const exists = currentWords.some(cw => 
              cw.word.toLowerCase() === w.word.toLowerCase() &&
              cw.action === w.action &&
              String(cw.duration) === String(w.duration) &&
              Boolean(cw.exactMatch) === Boolean(w.exactMatch)
          );
          
          if (!exists) {
              // If word text exists but settings are different, we still add it.
              // (If you prefer to overwrite instead of add duplicate texts, we can change this logic).
              store.addCustomWord(sessionUserId, {
                  word: w.word,
                  exactMatch: w.exactMatch || false,
                  action: w.action || 'ban',
                  duration: w.duration || 0,
                  channel: 'all' // Imported words apply to all channels by default
              });
              importedCount++;
          }
      }

      res.json({ success: true, importedCount });
  } catch (err) {
      console.error('[WordPreset] İçe aktarma hatası:', err);
      return res.status(500).json({ error: 'İçe aktarma sırasında bir hata oluştu.' });
  }
});

// ==== ADMIN PANEL ====
const requireAdmin = (req, res, next) => {
    // Sadece Kick API'den gelen ve doğrulanmış isim Riadein ise
    if (req.session.user && req.session.user.name && req.session.user.name.toLowerCase() === 'riadein') {
        next();
    } else {
        res.status(403).json({ error: 'Bu alana sadece geliştirici (Riadein) erişebilir.' });
    }
};

apiRouter.get('/admin/visitors', requireAdmin, (req, res) => {
    res.json(store.getVisitors());
});

apiRouter.post('/admin/ban', requireAdmin, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Kullanıcı kimliği belirtilmedi.' });
    
    const visitor = await store.banVisitor(userId);
    if (!visitor) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    
    // Disable automod system for this user immediately
    store.updateAutomodRules(userId, { enabled: false });
    
    res.json({ success: true, message: 'Kullanıcı yasaklandı ve sistemi durduruldu.' });
});

apiRouter.post('/admin/unban', requireAdmin, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Kullanıcı kimliği belirtilmedi.' });
    
    const visitor = await store.unbanVisitor(userId);
    if (!visitor) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    
    res.json({ success: true, message: 'Kullanıcının yasağı kaldırıldı.' });
});

apiRouter.delete('/admin/visitors', requireAdmin, async (req, res) => {
    store.visitors = [];
    if (process.env.MONGODB_URI) {
        const { Visitor } = require('./db');
        await Visitor.deleteMany({});
    }
    res.json({ success: true });
});
// =====================

// Server-Sent Events (SSE) stream for real-time updates to frontend
apiRouter.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Send initial data
  res.write(`event: init\ndata: ${JSON.stringify({ connected: true })}\n\n`);

  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  store.addSSEClient(res, sessionUserId);

  req.on('close', () => {
    store.removeSSEClient(res);
  });
});

app.use('/api', apiRouter);

// Start server
app.listen(PORT, () => {
  console.log(`Kick AutoMod server running on http://localhost:${PORT}`);
  console.log(`Make sure to set KICK_CLIENT_ID and KICK_CLIENT_SECRET in .env`);
});

app.use((req, res) => {
    res.status(404).send('Böyle bir sayfa veya API bulunamadı.');
});

// Global Error Handler (Sistemin çökmesini engeller)
app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        // CSRF Token Hatası
        console.warn('Geçersiz CSRF Token Yakalandı:', req.ip);
        return res.status(403).json({ error: 'Geçersiz güvenlik sertifikası (CSRF). Lütfen sayfayı yenileyin.' });
    }
    console.error('Kritik Sunucu Hatası Yakalandı:', err);
    res.status(500).json({ error: 'Sunucuda beklenmeyen bir hata oluştu ancak sistem güvenle çalışmaya devam ediyor.' });
});

} // end startServer

startServer().catch(console.error);
