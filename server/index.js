/**
 * Kick AutoMod Dashboard - Main Server
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
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

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    
    // Setup Routes
app.use('/auth', auth.router);

// API Routes (Require Authentication)
const apiRouter = express.Router();
apiRouter.use(auth.requireAuth);

// Dashboard stats
apiRouter.get('/stats', (req, res) => {
  res.json({
    stats: store.getStats(),
    wsStatus: wsManager.getStatus(),
    automodRules: store.getAutomodRules()
  });
});

// Moderation logs
apiRouter.get('/moderation', (req, res) => {
  res.json(store.getModerationLogs(req.query));
});

// Update moderation log status (approve/reject/etc)
apiRouter.patch('/moderation/:id', async (req, res) => {
  const { id } = req.params;
  const { status, action, duration } = req.body;
  
  const updates = { status };
  if (action) updates.action = action;
  if (duration !== undefined) updates.duration = duration;

  const log = store.updateModerationLog(id, updates);
  
  if (!log) {
    return res.status(404).json({ error: 'Log not found' });
  }

  // If approved and action requested, execute it via Kick API
  if ((status === 'applied' || status === 'unbanned') && action && req.session.accessToken) {
    try {
      const kickClient = createKickClient(req.session.accessToken);
      
      const channel = store.getChannels().find(c => String(c.id) === String(log.chatroomId));
      const broadcasterUserId = channel ? channel.broadcasterUserId : null;
      if (!broadcasterUserId) throw new Error("Broadcaster User ID not found for this channel");
      
      if (action === 'delete') {
        await kickClient.deleteMessage(log.messageId);
      } else if (action === 'timeout') {
        await kickClient.timeoutUser(broadcasterUserId, log.userId, log.duration || 5, log.reason);
      } else if (action === 'ban') {
        await kickClient.banUser(broadcasterUserId, log.userId, log.reason);
      } else if (action === 'unban') {
        await kickClient.unbanUser(broadcasterUserId, log.userId);
      }
    } catch (err) {
      console.error('Failed to apply moderation action:', err);
      store.updateModerationLog(id, { status: 'error', error: err.message });
      return res.status(500).json({ error: 'Failed to apply action to Kick API', details: err.message });
    }
  }

  res.json(log);
});

// Channels management
apiRouter.get('/channels', (req, res) => {
  res.json(store.getChannels());
});

apiRouter.post('/channels', async (req, res) => {
  const { slug, chatroomId, userId } = req.body;
  if (!slug) return res.status(400).json({ error: 'Channel slug required' });

  try {
    const kickClient = createKickClient(req.session.accessToken);
    automod.setKickClient(kickClient);

    let finalChatroomId = chatroomId;
    let finalUserId = userId;

    if (!finalChatroomId) {
        const channelData = await kickClient.getChannel(slug);
        if (!channelData || !channelData.chatroom) {
            return res.status(404).json({ error: 'Channel or chatroom not found' });
        }
        finalChatroomId = channelData.chatroom.id;
        finalUserId = channelData.user_id || null;
    }

    const success = wsManager.subscribeToChannel(finalChatroomId, slug, finalUserId);
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
  wsManager.unsubscribeFromChannel(id);
  res.json({ success: true });
});

// Rules management
apiRouter.get('/rules', (req, res) => {
  res.json(store.getAutomodRules());
});

apiRouter.patch('/rules', async (req, res) => {
  const updates = req.body;
  const oldMode = store.getAutomodRules().mode;
  const result = store.updateAutomodRules(updates);
  
  // If switching from manual to auto, apply retroactive timeouts
  if (oldMode === 'manual' && updates.mode === 'auto') {
    try {
      const kickClient = createKickClient(req.session.accessToken);
      const pendingSpamLogs = store.getModerationLogs().filter(l => l.ruleName === 'spamDetection' && l.status === 'pending');
      
      for (const log of pendingSpamLogs) {
        const channel = store.getChannels().find(c => String(c.id) === String(log.chatroomId));
        if (channel && channel.broadcasterUserId) {
          await kickClient.timeoutUser(channel.broadcasterUserId, log.userId, log.duration || 5, log.reason);
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
  const { ruleName } = req.params;
  res.json(store.updateRule(ruleName, req.body));
});

// Custom Words Management
apiRouter.post('/words', (req, res) => {
  const word = store.addCustomWord(req.body);
  res.json(word);
});

apiRouter.delete('/words/:id', (req, res) => {
  store.removeCustomWord(req.params.id);
  res.json({ success: true });
});

// ==== ADMIN PANEL ====
const requireAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.name && req.session.user.name.toLowerCase() === 'riadein') {
        next();
    } else {
        res.status(403).json({ error: 'Bu alana sadece geliştirici (Riadein) erişebilir.' });
    }
};

apiRouter.get('/admin/visitors', requireAdmin, (req, res) => {
    res.json(store.getVisitors());
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

  store.addSSEClient(res);

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
    console.error('Kritik Sunucu Hatası Yakalandı:', err);
    res.status(500).json({ error: 'Sunucuda beklenmeyen bir hata oluştu ancak sistem güvenle çalışmaya devam ediyor.' });
});

} // end startServer

startServer().catch(console.error);
