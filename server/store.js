/**
 * Kick AutoMod Dashboard - In-Memory Store & MongoDB Persistence
 * Moderasyon logları, kanal durumları ve konfigürasyon
 */
const { Channel, Word, AutomodRule, Visitor, ChatMessage, ModerationLog } = require('./db');

class Store {
  constructor() {
    this.moderationLogs = [];
    this.channels = [];
    this.visitors = [];
    this.stats = {
      totalModeration: 0,
      pending: 0,
      applied: 0,
      activeChannels: 0,
      messagesReceived: 0
    };
    this.userRules = new Map(); // userId -> rules object
    this.userMessageHistory = new Map(); // userId -> [{message, timestamp}]
    this.sseClients = new Set();
    this.userLastActive = new Map(); // userId -> timestamp
    this.userSettings = new Map(); // userId -> { chatWatchedWords, chatDefaultTimeout, ... }
    this.chatHistory = new Map(); // channelSlug -> [{sender, content, timestamp, ...}]
  }

  // Chat History Buffer
  addChatMessage(channelSlug, msgData) {
    if (!this.chatHistory.has(channelSlug)) {
      this.chatHistory.set(channelSlug, []);
    }
    const buffer = this.chatHistory.get(channelSlug);
    buffer.push(msgData);
    if (buffer.length > 500) {
      buffer.splice(0, buffer.length - 500);
    }
    
    // Save to MongoDB for persistence across server restarts
    if (process.env.MONGODB_URI) {
        ChatMessage.create({
            channelSlug: channelSlug,
            messageId: msgData.id,
            content: msgData.content,
            username: msgData.username,
            userId: msgData.userId || msgData.user_id,
            timestamp: msgData.timestamp,
            sender: msgData.sender
        }).catch(err => {
            console.error('[Store] Failed to save chat message to DB:', err.message);
        });
    }
  }

  getChatHistory(channelSlug, limit = 500) {
    return (this.chatHistory.get(channelSlug) || []).slice(-limit);
  }

  // User Settings (server-side persistence)
  getUserSettings(userId) {
    return this.userSettings.get(String(userId)) || {};
  }

  updateUserSettings(userId, updates) {
    const key = String(userId);
    const existing = this.userSettings.get(key) || {};
    const merged = { ...existing, ...updates };
    this.userSettings.set(key, merged);
    return merged;
  }

  // Generate default rules for a new user
  _getDefaultRules() {
    return {
      enabled: true,
      mode: 'manual', // Default to manual
      rules: {
        bannedWords: {
          enabled: true,
          name: 'Yasaklı Kelimeler',
          words: [],
          action: 'timeout',
          duration: 5, // minutes
          customPatterns: []
        },
        spamDetection: {
          enabled: true,
          name: 'Spam Tespiti',
          maxRepeats: 3,
          timeWindow: 60, // seconds
          maxMessagesPerMinute: 20,
          action: 'timeout',
          duration: 5
        },
        emoteSpam: {
          enabled: false, // Default to disabled
          name: 'Emote Spam',
          maxRepeats: 3,
          maxEmotes: 15,
          action: 'timeout',
          duration: 5
        }
      }
    };
  }

  // ==== Database Persistence Methods ====
  async loadFromDB() {
    if (!process.env.MONGODB_URI) return;
    
    try {
      const dbChannels = await Channel.find({});
      this.channels = dbChannels.map(c => ({ 
        id: c.chatroomId, 
        slug: c.slug, 
        chatroomId: c.chatroomId, 
        userId: c.userId, 
        broadcasterUserId: c.userId, 
        addedBy: c.addedBy || '', 
        active: true 
      }));
      this.stats.activeChannels = this.channels.length;

      const dbWords = await Word.find({});
      const dbRules = await AutomodRule.find({});
      
      // Initialize map with fetched rules
      for (const dbRule of dbRules) {
         const rules = this._getDefaultRules();
         rules.mode = dbRule.mode;
         rules.enabled = dbRule.enabled;
         rules.rules.bannedWords.enabled = dbRule.bannedWordsEnabled ?? rules.rules.bannedWords.enabled;
         rules.rules.spamDetection.enabled = dbRule.spamDetectionEnabled ?? rules.rules.spamDetection.enabled;
         rules.rules.emoteSpam.enabled = dbRule.emoteSpamEnabled ?? rules.rules.emoteSpam.enabled;
         
         rules.rules.spamDetection.maxRepeats = dbRule.spamMaxRepeats ?? rules.rules.spamDetection.maxRepeats;
         rules.rules.emoteSpam.maxRepeats = dbRule.emoteMaxRepeats ?? rules.rules.emoteSpam.maxRepeats;
         
         this.userRules.set(dbRule.userId, rules);
      }
      
      // Bütün kelimeleri ait oldukları kullanıcılara bağla (duplicate kontrolüyle)
      for (const w of dbWords) {
          const userId = w.addedBy;
          if (!userId) continue;
          
          if (!this.userRules.has(userId)) {
              this.userRules.set(userId, this._getDefaultRules());
          }
          const rules = this.userRules.get(userId);
          
          // Fallback: Eski kelimeler action/duration eksik olabilir
          const wordAction = w.action || 'ban';
          const wordDuration = w.duration || (wordAction === 'timeout' ? 5 : 0);
          const wordChannel = w.channel || 'all';
          
          // Hem ID hem de kelime içeriği bazında duplicate kontrolü
          const exists = rules.rules.bannedWords.words.some(cw => cw.id === w.id || (cw.word === w.word && cw.action === wordAction && (cw.targetUsername || '') === (w.targetUsername || '')));
          if (!exists) {
              rules.rules.bannedWords.words.push({
                  id: w.id, channel: wordChannel, word: w.word, exactMatch: w.exactMatch || false, action: wordAction, duration: wordDuration, addedBy: w.addedBy, enabled: w.enabled !== false, targetUsername: w.targetUsername || ''
              });
          }
      }
      console.log(`[Store] Loaded words per user: ${[...this.userRules.entries()].map(([u, r]) => `${u}=${r.rules.bannedWords.words.length}`).join(', ')}`);
      
      try {
          const dbVisitors = await Visitor.find({}).sort({ lastLogin: -1 });
          this.visitors = dbVisitors.map(v => v.toObject());
      } catch (e) {
          console.error('[Store] Visitor load error:', e);
      }
      
      try {
          // Her kanal için sadece son 200 mesajı yükle
          const recentMessages = await ChatMessage.find({}).sort({ createdAt: -1 }).limit(10000); // En son mesajlar
          // Eski mesajlardan yeniye doğru dizilmeli
          recentMessages.reverse();
          for (const msg of recentMessages) {
              if (!this.chatHistory.has(msg.channelSlug)) {
                  this.chatHistory.set(msg.channelSlug, []);
              }
              this.chatHistory.get(msg.channelSlug).push({
                  id: msg.messageId,
                  content: msg.content,
                  username: msg.username,
                  userId: msg.userId,
                  timestamp: msg.timestamp,
                  sender: msg.sender
              });
          }
      } catch (e) {
          console.error('[Store] ChatMessage load error:', e);
      }
      const dbLogs = await ModerationLog.find({}).sort({ createdAt: -1 }).limit(500);
      this.moderationLogs = dbLogs.map(l => ({
          id: l.id,
          channel: l.channel,
          chatroomId: l.chatroomId,
          userId: l.userId,
          messageId: l.messageId,
          username: l.username,
          messageContent: l.messageContent,
          ruleName: l.ruleName,
          reason: l.reason,
          type: l.type,
          action: l.action,
          duration: l.duration,
          status: l.status,
          ownerId: l.ownerId,
          createdAt: l.createdAt
      }));
      
      this.stats.totalModeration = this.moderationLogs.length;
      this.stats.applied = this.moderationLogs.filter(l => l.status === 'applied').length;
      this.stats.pending = this.moderationLogs.filter(l => l.status === 'pending').length;

      console.log(`[Store] Veritabanından veriler başarıyla yüklendi. (Logs: ${this.moderationLogs.length})`);
    } catch (err) {
      console.error('[Store] DB yükleme hatası:', err);
    }
  }

  saveChannel(channel) {
    if (!process.env.MONGODB_URI) return;
    Channel.create({ slug: channel.slug, chatroomId: channel.chatroomId, userId: channel.userId, addedBy: channel.addedBy || '' }).catch(console.error);
  }

  deleteChannelDB(slug, userId) {
    if (!process.env.MONGODB_URI) return;
    Channel.deleteOne({ slug, addedBy: userId }).catch(console.error);
  }

  saveWord(word) {
    if (!process.env.MONGODB_URI) return;
    Word.create({ id: word.id, channel: word.channel, word: word.word, exactMatch: word.exactMatch, action: word.action, duration: word.duration, addedBy: word.addedBy || '', targetUsername: word.targetUsername || '' }).catch(console.error);
  }

  deleteWordDB(id) {
    if (!process.env.MONGODB_URI) return;
    Word.deleteOne({ id }).catch(console.error);
  }

  async saveRules(userId) {
    if (!process.env.MONGODB_URI) return;
    const rules = this.userRules.get(userId);
    if (!rules) return;
    await AutomodRule.updateOne({ userId: userId }, {
      mode: rules.mode,
      enabled: rules.enabled,
      bannedWordsEnabled: rules.rules.bannedWords.enabled,
      spamDetectionEnabled: rules.rules.spamDetection.enabled,
      emoteSpamEnabled: rules.rules.emoteSpam.enabled,
      spamMaxRepeats: rules.rules.spamDetection.maxRepeats,
      emoteMaxRepeats: rules.rules.emoteSpam.maxRepeats,
      addedBy: userId
    }, { upsert: true }).catch(console.error);
  }

  // ==== Visitors Management ====
  async addVisitor(visitorData) {
    const id = visitorData.kickId || `v_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    // Match by kickId first, then fallback to username
    let existingIndex = -1;
    if (visitorData.kickId) {
      existingIndex = this.visitors.findIndex(v => 
        String(v.kickId) === String(visitorData.kickId)
      );
    }
    if (existingIndex < 0 && visitorData.username) {
      existingIndex = this.visitors.findIndex(v => 
        v.username && v.username.toLowerCase() === visitorData.username.toLowerCase()
      );
    }
    
    if (existingIndex >= 0) {
      this.visitors[existingIndex].loginCount = (this.visitors[existingIndex].loginCount || 1) + 1;
      this.visitors[existingIndex].lastLogin = new Date();
      
      // If we now have a kickId but existing record doesn't, update it
      if (visitorData.kickId && !this.visitors[existingIndex].kickId) {
        this.visitors[existingIndex].kickId = visitorData.kickId;
      }
      
      Object.assign(this.visitors[existingIndex], visitorData); // Update IP, names, etc.
      
      if (process.env.MONGODB_URI) {
          // Use multiple filters for robust matching
          const filter = this.visitors[existingIndex].kickId 
            ? { $or: [{ id: this.visitors[existingIndex].id }, { kickId: String(this.visitors[existingIndex].kickId) }, { username: this.visitors[existingIndex].username }] }
            : { $or: [{ id: this.visitors[existingIndex].id }, { username: this.visitors[existingIndex].username }] };
          Visitor.updateOne(filter, { $set: this.visitors[existingIndex] }).catch(err => {
            console.error('[Store] Visitor DB update failed:', err.message);
          });
      }
      return this.visitors[existingIndex];
    } else {
      const newVisitor = {
        id,
        loginCount: 1,
        lastLogin: new Date(),
        ...visitorData
      };
      this.visitors.unshift(newVisitor);
      if (process.env.MONGODB_URI) {
          Visitor.create(newVisitor).catch(err => {
            console.error('[Store] Visitor DB create failed:', err.message);
          });
      }
      return newVisitor;
    }
  }

  getVisitors() {
    return this.visitors;
  }
  
  async banVisitor(userId) {
      const visitor = this.visitors.find(v => v.id === userId || v.kickId === userId);
      if (visitor) {
          visitor.isBanned = true;
          // DB update
          if (process.env.MONGODB_URI) {
              const { Visitor } = require('./db');
              await Visitor.updateOne({ id: visitor.id }, { isBanned: true });
          }
          return visitor;
      }
      return null;
  }
  
  async unbanVisitor(userId) {
      const visitor = this.visitors.find(v => v.id === userId || v.kickId === userId);
      if (visitor) {
          visitor.isBanned = false;
          // DB update
          if (process.env.MONGODB_URI) {
              const { Visitor } = require('./db');
              await Visitor.updateOne({ id: visitor.id }, { isBanned: false });
          }
          return visitor;
      }
      return null;
  }
  
  isIpBanned(ip) {
      return this.visitors.some(v => v.ip === ip && v.isBanned);
  }
  
  isUserBanned(userId) {
      return this.visitors.some(v => (v.id === userId || v.kickId === userId) && v.isBanned);
  }
  // ======================================

  // SSE Client Management
  addSSEClient(res, userId) {
    this.sseClients.add({ res, userId });
  }

  removeSSEClient(res) {
    for (const client of this.sseClients) {
      if (client.res === res) {
        this.sseClients.delete(client);
        break;
      }
    }
  }

  // Check if a user has an active browser connection
  isUserOnline(userId) {
    // Check SSE connection first
    for (const client of this.sseClients) {
      if (String(client.userId) === String(userId)) {
        return true;
      }
    }
    // Fallback: check last API activity (5 min window)
    const lastActive = this.userLastActive.get(String(userId));
    if (lastActive && (Date.now() - lastActive) < 5 * 60 * 1000) {
      return true;
    }
    return false;
  }

  // Update user's last activity timestamp
  touchUser(userId) {
    this.userLastActive.set(String(userId), Date.now());
  }

  broadcastToUser(userId, event, data) {
    for (const client of this.sseClients) {
      if (String(client.userId) === String(userId)) {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          client.res.write(payload);
        } catch (e) {
          this.sseClients.delete(client);
        }
      }
    }
  }

  broadcast(event, data, targetUserId = null) {
    for (const client of this.sseClients) {
      if (targetUserId && client.userId !== targetUserId) continue;
      
      // Filter data for this specific user before sending
      let userSpecificData = { ...data };
      
      if (event === 'channelUpdate' && data.channels) {
        userSpecificData.channels = data.channels.filter(c => c.addedBy === client.userId);
        userSpecificData.stats = this.getUserStats(client.userId);
      } else if ((event === 'newModeration' || event === 'moderationUpdate') && data.log) {
        // Only send log if it belongs to a channel added by this user
        const hasChannel = this.channels.some(c => 
             (String(c.id) === String(data.log.chatroomId) || c.slug === data.log.channel) 
             && c.addedBy === client.userId
        );
        if (!hasChannel) {
           continue; // skip sending this log to this user
        }
        userSpecificData.stats = this.getUserStats(client.userId);
      } else if (event === 'chatMessage' && data.channel) {
        // Only send chat message if it belongs to a channel added by this user (or an old channel without addedBy)
        const hasChannel = this.channels.some(c => c.slug === data.channel && (!c.addedBy || c.addedBy === client.userId));
        if (!hasChannel) continue;
      }

      const payload = `event: ${event}\ndata: ${JSON.stringify(userSpecificData)}\n\n`;
      try {
        client.res.write(payload);
      } catch (e) {
        this.sseClients.delete(client);
      }
    }
  }

  getUserStats(userId) {
    const userChannels = this.channels.filter(c => c.addedBy === userId);
    const userChannelSlugs = userChannels.map(c => c.slug);
    const userChatroomIds = userChannels.map(c => String(c.id));
    
    const userLogs = this.moderationLogs.filter(l => 
      userChannelSlugs.includes(l.channel) || userChatroomIds.includes(String(l.chatroomId))
    );

    return {
      totalModeration: userLogs.length,
      pending: userLogs.filter(l => l.status === 'pending').length,
      applied: userLogs.filter(l => l.status === 'applied').length,
      activeChannels: userChannels.filter(c => c.active).length,
      messagesReceived: this.stats.messagesReceived // Global or keep track per user?
    };
  }

  // Channel Management
  addChannel(channel) {
    const channelIdStr = String(channel.id || channel.chatroomId);
    
    // YENİ DÜZELTME: Aynı kanalı BİRDEN FAZLA kişinin takip edebilmesi için
    // sadece "slug" a bakarak değil, "slug + addedBy" kombinasyonuna bakarak
    // duplicate kontrolü yapmalıyız. Yoksa A kişisi sistemi durdurduğunda B kişisinin sistemi de duruyor!
    const exists = this.channels.find(c => 
        (String(c.id) === channelIdStr || c.slug === channel.slug) && 
        c.addedBy === channel.addedBy
    );
    
    if (!exists) {
      const newChannel = {
        ...channel,
        chatroomId: channel.id, // chatroomId = id (from websocket)
        addedAt: new Date().toISOString(),
        active: true
      };
      this.channels.push(newChannel);
      this.stats.activeChannels = this.channels.filter(c => c.active).length;
      this.saveChannel(newChannel); // save to DB
      this.broadcast('channelUpdate', { channels: this.channels });
    }
    return this.channels;
  }

  removeChannel(channelId, userId) {
    const strId = String(channelId);
    const channelIndex = this.channels.findIndex(c => (String(c.id) === strId || String(c.chatroomId) === strId || c.slug === channelId) && c.addedBy === userId);
    
    if (channelIndex > -1) {
      const channel = this.channels[channelIndex];
      this.deleteChannelDB(channel.slug, userId); // delete from DB for this user
      this.channels.splice(channelIndex, 1);
      this.stats.activeChannels = this.channels.filter(c => c.active).length;
      this.broadcast('channelUpdate', { channels: this.channels });
    }
    return this.channels;
  }

  getChannels() {
    return this.channels;
  }

  // Moderation Log Management
  addModerationLog(log) {
    if (log.ruleName === 'spamDetection' || log.ruleName === 'emoteSpam') {
      const fiveMinsAgo = Date.now() - (5 * 60 * 1000);
      const existing = this.moderationLogs.find(l => 
          l.userId === log.userId && 
          l.channel === log.channel && 
          (l.ruleName === 'spamDetection' || l.ruleName === 'emoteSpam') &&
          l.messageContent === log.messageContent &&
          new Date(l.createdAt).getTime() > fiveMinsAgo
      );
      
      if (existing) {
          existing.spamCount = log.spamCount || ((existing.spamCount || 3) + 1);
          existing.status = log.status || existing.status;
          existing.action = log.action || existing.action;
          existing.createdAt = new Date().toISOString();
          
          if (process.env.MONGODB_URI) {
              ModerationLog.updateOne(
                  { id: existing.id }, 
                  { $set: { 
                      spamCount: existing.spamCount, 
                      status: existing.status, 
                      action: existing.action, 
                      createdAt: existing.createdAt 
                  } }
              ).catch(err => {
                  console.error('[Store] Failed to update spam log in DB:', err.message);
              });
          }
          
          if (existing.ownerId) {
              this.broadcastToUser(existing.ownerId, 'updateModeration', { log: existing, stats: this.stats });
          } else {
              this.broadcast('updateModeration', { log: existing, stats: this.stats });
          }
          return existing;
      }
    }

    const entry = {
      id: `mod_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      ...log,
      createdAt: new Date().toISOString(),
      status: log.status || 'pending' // pending, applied, rejected
    };
    this.moderationLogs.unshift(entry);
    this.stats.totalModeration++;
    if (entry.status === 'pending') this.stats.pending++;
    if (entry.status === 'applied') this.stats.applied++;
    
    // Save to DB
    if (process.env.MONGODB_URI) {
        ModerationLog.create(entry).catch(err => {
            console.error('[Store] Failed to save moderation log to DB:', err.message);
        });
    }
    
    // Keep only last 500 entries
    if (this.moderationLogs.length > 500) {
      this.moderationLogs = this.moderationLogs.slice(0, 500);
    }

    if (entry.ownerId) {
        this.broadcastToUser(entry.ownerId, 'newModeration', { log: entry, stats: this.stats });
    } else {
        this.broadcast('newModeration', { log: entry, stats: this.stats });
    }
    return entry;
  }

  updateModerationLog(logId, updates) {
    const log = this.moderationLogs.find(l => l.id === logId);
    if (log) {
      const oldStatus = log.status;
      Object.assign(log, updates);
      
      if (process.env.MONGODB_URI) {
          ModerationLog.updateOne({ id: logId }, { $set: updates }).catch(err => {
              console.error('[Store] Failed to update moderation log in DB:', err.message);
          });
      }
      
      // Temporary debug: Dump to disk if error
      if (updates.status === 'error') {
          const fs = require('fs');
          fs.writeFileSync('C:\\Users\\ardak\\Desktop\\kick-automod\\debug-error.log', JSON.stringify(log, null, 2));
      }

      // Update stats
      if (oldStatus === 'pending' && updates.status !== 'pending') this.stats.pending--;
      if (updates.status === 'applied' && oldStatus !== 'applied') this.stats.applied++;
      
      if (log.ownerId) {
          this.broadcastToUser(log.ownerId, 'moderationUpdate', { log, stats: this.stats });
      } else {
          this.broadcast('moderationUpdate', { log, stats: this.stats });
      }
    }
    return log;
  }

  getModerationLogs(filters = {}) {
    let logs = [...this.moderationLogs];
    if (filters.ownerId) logs = logs.filter(l => String(l.ownerId) === String(filters.ownerId));
    if (filters.channel) logs = logs.filter(l => l.channel === filters.channel);
    if (filters.type) logs = logs.filter(l => l.type === filters.type);
    if (filters.status) logs = logs.filter(l => l.status === filters.status);
    return logs;
  }

  clearModerationLogs() {
    this.moderationLogs = [];
    this.stats.totalModeration = 0;
    this.stats.pending = 0;
    this.stats.applied = 0;
    this.broadcast('stats', this.stats);
  }

  // Stats
  getStats() {
    return { ...this.stats };
  }

  incrementMessages() {
    this.stats.messagesReceived++;
    // Broadcast stats every 10 messages to avoid spam
    if (this.stats.messagesReceived % 10 === 0) {
      this.broadcast('statsUpdate', { stats: this.stats });
    }
  }

  // User Message History (for spam detection)
  addUserMessage(userId, messageContent, messageId) {
    if (!this.userMessageHistory.has(userId)) {
      this.userMessageHistory.set(userId, []);
    }
    const history = this.userMessageHistory.get(userId);
    
    // Prevent duplicating the exact same message event (e.g. if multiple moderators monitor the same channel)
    if (messageId && history.length > 0 && history[history.length - 1].id === messageId) {
        return history;
    }
    
    history.push({ id: messageId, message: messageContent, timestamp: Date.now() });
    // Zaman sınırı olmadan son 200 mesajı tut
    const filtered = history.slice(-200);
    this.userMessageHistory.set(userId, filtered);
    return filtered;
  }

  getUserMessageHistory(userId) {
    return this.userMessageHistory.get(userId) || [];
  }

  clearUserMessageHistory(userId) {
    this.userMessageHistory.delete(userId);
  }

  // AutoMod Rules
  getAutomodRules(userId) {
    if (!this.userRules.has(userId)) {
        this.userRules.set(userId, this._getDefaultRules());
    }
    return this.userRules.get(userId);
  }

  updateAutomodRules(userId, updates) {
    const rules = this.getAutomodRules(userId);
    Object.assign(rules, updates);
    this.saveRules(userId); // save to DB
    this.broadcastToUser(userId, 'rulesUpdate', { rules: rules });
    return rules;
  }

  updateRule(userId, ruleName, updates) {
    const rules = this.getAutomodRules(userId);
    if (rules.rules[ruleName]) {
      Object.assign(rules.rules[ruleName], updates);
      this.saveRules(userId); // save to DB
      this.broadcastToUser(userId, 'rulesUpdate', { rules: rules });
    }
    return rules;
  }

  addCustomWord(userId, wordData) {
    const rules = this.getAutomodRules(userId);
    
    // Aynı kelime zaten varsa ekleme
    const duplicate = rules.rules.bannedWords.words.some(w => w.word === wordData.word && w.action === wordData.action && (w.targetUsername || '') === (wordData.targetUsername || ''));
    if (duplicate) {
      this.broadcastToUser(userId, 'rulesUpdate', { rules: rules });
      return null;
    }
    
    const word = {
      id: `w_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      addedBy: userId,
      ...wordData
    };
    rules.rules.bannedWords.words.push(word);
    this.saveWord(word); // save to DB
    this.broadcastToUser(userId, 'rulesUpdate', { rules: rules });
    return word;
  }

  removeCustomWord(userId, wordId) {
    const rules = this.getAutomodRules(userId);
    rules.rules.bannedWords.words = rules.rules.bannedWords.words.filter(w => w.id !== wordId);
    this.deleteWordDB(wordId); // delete from DB
    this.broadcastToUser(userId, 'rulesUpdate', { rules: rules });
    return true;
  }

  toggleCustomWord(userId, wordId, enabled) {
    const rules = this.getAutomodRules(userId);
    const word = rules.rules.bannedWords.words.find(w => w.id === wordId);
    if (word) {
      word.enabled = enabled;
      if (process.env.MONGODB_URI) {
        const { Word } = require('./db');
        Word.updateOne({ id: wordId }, { enabled: enabled }).catch(console.error);
      }
      this.broadcastToUser(userId, 'rulesUpdate', { rules: rules });
      return word;
    }
    return null;
  }

  removeAllCustomWords(userId) {
    const rules = this.getAutomodRules(userId);
    rules.rules.bannedWords.words = [];
    if (process.env.MONGODB_URI) {
        const { Word } = require('./db');
        Word.deleteMany({ userId }).catch(e => console.error(e));
    }
    this.broadcastToUser(userId, 'rulesUpdate', { rules: rules });
    return true;
  }
}

// Singleton
const store = new Store();
module.exports = store;
