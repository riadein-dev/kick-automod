/**
 * Kick AutoMod Dashboard - In-Memory Store & MongoDB Persistence
 * Moderasyon logları, kanal durumları ve konfigürasyon
 */
const { Channel, Word, AutomodRule, Visitor } = require('./db');

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
  }

  // Generate default rules for a new user
  _getDefaultRules() {
    return {
      enabled: true,
      mode: 'auto', // 'auto' or 'manual'
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
          enabled: true,
          name: 'Emote Spam',
          maxEmotes: 15,
          action: 'delete',
          duration: 0
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
         rules.rules.bannedWords.enabled = dbRule.bannedWordsEnabled;
         rules.rules.spamDetection.enabled = dbRule.spamDetectionEnabled;
         rules.rules.emoteSpam.enabled = dbRule.emoteSpamEnabled;
         
         // Attach words for this user
         rules.rules.bannedWords.words = dbWords.filter(w => w.addedBy === dbRule.userId).map(w => ({
            id: w.id, channel: w.channel, word: w.word, exactMatch: w.exactMatch, action: w.action, duration: w.duration, addedBy: w.addedBy
         }));
         
         this.userRules.set(dbRule.userId, rules);
      }
      
      try {
          const dbVisitors = await Visitor.find({}).sort({ lastLogin: -1 });
          this.visitors = dbVisitors.map(v => v.toObject());
      } catch (e) {
          console.error('[Store] Visitor load error:', e);
      }
      
      console.log('[Store] Veritabanından veriler başarıyla yüklendi.');
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
    Word.create({ id: word.id, channel: word.channel, word: word.word, exactMatch: word.exactMatch, action: word.action, duration: word.duration, addedBy: word.addedBy || '' }).catch(console.error);
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
      addedBy: userId
    }, { upsert: true }).catch(console.error);
  }

  // ==== Visitors Management ====
  async addVisitor(visitorData) {
    const id = visitorData.kickId || `v_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const existingIndex = this.visitors.findIndex(v => 
        visitorData.kickId && String(v.kickId) === String(visitorData.kickId)
    );
    
    if (existingIndex >= 0) {
      this.visitors[existingIndex].loginCount = (this.visitors[existingIndex].loginCount || 1) + 1;
      this.visitors[existingIndex].lastLogin = new Date();
      Object.assign(this.visitors[existingIndex], visitorData); // Update IP, names, etc.
      
      if (process.env.MONGODB_URI) {
          Visitor.updateOne({ id: this.visitors[existingIndex].id }, { $set: this.visitors[existingIndex] }).catch(console.error);
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
          Visitor.create(newVisitor).catch(console.error);
      }
      return newVisitor;
    }
  }

  getVisitors() {
      return this.visitors;
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
}

// Singleton
const store = new Store();
module.exports = store;
