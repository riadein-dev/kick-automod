const fs = require('fs');

const file = 'server/index.js';
let content = fs.readFileSync(file, 'utf8');

// The file got completely mangled. Let's find the /chat/send endpoint start and the start of apiRouter.delete('/channels/:id' which is safe
const startMark = "// Chat Send Message\r\napiRouter.post('/chat/send'";
const endMark = "apiRouter.delete('/channels/:id', (req, res) => {";

const startIndex = content.indexOf(startMark);
const endIndex = content.indexOf(endMark);

if (startIndex === -1 || endIndex === -1) {
    console.error("Couldn't find markers");
    process.exit(1);
}

const newBlock = `// Chat Send Message
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

// User Settings (per-user, server-side persistence via MongoDB)
apiRouter.get('/user-settings', async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    
    // Önce hafızadan dene
    let settings = store.getUserSettings(userId);
    
    // Hafızada yoksa MongoDB'den yükle
    if (!settings || Object.keys(settings).length === 0) {
        try {
            const { UserSettings } = require('./db');
            const dbSettings = await UserSettings.findOne({ userId: String(userId) });
            if (dbSettings) {
                settings = {
                    chatWatchedWords: dbSettings.chatWatchedWords || '',
                    chatDefaultTimeout: dbSettings.chatDefaultTimeout || 5
                };
                store.updateUserSettings(userId, settings);
            }
        } catch (e) {
            console.error('[UserSettings] MongoDB okuma hatası:', e.message);
        }
    }
    
    res.json(settings || {});
});

apiRouter.patch('/user-settings', async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    
    const updates = req.body;
    store.updateUserSettings(userId, updates);
    
    // MongoDB'ye de kalıcı olarak kaydet
    try {
        const { UserSettings } = require('./db');
        await UserSettings.findOneAndUpdate(
            { userId: String(userId) },
            { ...updates, updatedAt: new Date() },
            { upsert: true, new: true }
        );
    } catch (e) {
        console.error('[UserSettings] MongoDB kayıt hatası:', e.message);
    }
    
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
  console.log(\`[Channels] Clearing channels for user: \${sessionUserId}\`);
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

`;

const finalContent = content.substring(0, startIndex) + newBlock + content.substring(endIndex);
fs.writeFileSync(file, finalContent);
console.log("Fixed!");
