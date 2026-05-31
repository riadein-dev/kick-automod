/**
 * Kick AutoMod Dashboard - In-Memory Store & MongoDB Persistence
 * Moderasyon logları, kanal durumları ve konfigürasyon
 */
const { Channel, Word, AutomodRule } = require('./db');

class Store {
  constructor() {
    this.moderationLogs = [];
    this.channels = [];
    this.stats = {
      totalModeration: 0,
      pending: 0,
      applied: 0,
      activeChannels: 0,
      messagesReceived: 0
    };
    this.automodRules = {
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
        linkBlocking: {
          enabled: true,
          name: 'Link Engelleme',
          allowedDomains: ['kick.com', 'youtube.com', 'twitch.tv'],
          blockAll: false,
          action: 'delete',
          duration: 0
        },
        capsLock: {
          enabled: true,
          name: 'Caps Lock Limiti',
          threshold: 70, // percentage
          minLength: 10,
          action: 'delete',
          duration: 0
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
    this.userMessageHistory = new Map(); // userId -> [{message, timestamp}]
    this.sseClients = new Set();
  }

  // ==== Database Persistence Methods ====
  async loadFromDB() {
    if (!process.env.MONGODB_URI) return;
    
    try {
      const dbChannels = await Channel.find({});
      this.channels = dbChannels.map(c => ({ id: c.slug, slug: c.slug, chatroomId: c.chatroomId, userId: c.userId, active: true }));
      this.stats.activeChannels = this.channels.length;

      const dbWords = await Word.find({});
      this.automodRules.rules.bannedWords.words = dbWords.map(w => ({
        id: w.id, channel: w.channel, word: w.word, exactMatch: w.exactMatch, action: w.action, duration: w.duration
      }));

      let dbRule = await AutomodRule.findOne({ type: 'global' });
      if (!dbRule) {
        dbRule = await AutomodRule.create({ type: 'global' });
      }
      this.automodRules.mode = dbRule.mode;
      this.automodRules.enabled = dbRule.enabled;
      this.automodRules.rules.bannedWords.enabled = dbRule.bannedWordsEnabled;
      this.automodRules.rules.spamDetection.enabled = dbRule.spamDetectionEnabled;
      this.automodRules.rules.linkBlocking.enabled = dbRule.linkBlockingEnabled;
      this.automodRules.rules.emoteSpam.enabled = dbRule.emoteSpamEnabled;
      
      console.log('[Store] Veritabanından veriler başarıyla yüklendi.');
    } catch (err) {
      console.error('[Store] DB yükleme hatası:', err);
    }
  }

  saveChannel(channel) {
    if (!process.env.MONGODB_URI) return;
    Channel.create({ slug: channel.slug, chatroomId: channel.chatroomId, userId: channel.userId }).catch(console.error);
  }

  deleteChannelDB(slug) {
    if (!process.env.MONGODB_URI) return;
    Channel.deleteOne({ slug }).catch(console.error);
  }

  saveWord(word) {
    if (!process.env.MONGODB_URI) return;
    Word.create({ id: word.id, channel: word.channel, word: word.word, exactMatch: word.exactMatch, action: word.action, duration: word.duration }).catch(console.error);
  }

  deleteWordDB(id) {
    if (!process.env.MONGODB_URI) return;
    Word.deleteOne({ id }).catch(console.error);
  }

  async saveRules() {
    if (!process.env.MONGODB_URI) return;
    await AutomodRule.updateOne({ type: 'global' }, {
      mode: this.automodRules.mode,
      enabled: this.automodRules.enabled,
      bannedWordsEnabled: this.automodRules.rules.bannedWords.enabled,
      spamDetectionEnabled: this.automodRules.rules.spamDetection.enabled,
      linkBlockingEnabled: this.automodRules.rules.linkBlocking.enabled,
      emoteSpamEnabled: this.automodRules.rules.emoteSpam.enabled
    }, { upsert: true }).catch(console.error);
  }
  // ======================================

  // SSE Client Management
  addSSEClient(res) {
    this.sseClients.add(res);
  }

  removeSSEClient(res) {
    this.sseClients.delete(res);
  }

  broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch (e) {
        this.sseClients.delete(client);
      }
    }
  }

  // Channel Management
  addChannel(channel) {
    const exists = this.channels.find(c => c.id === channel.id || c.slug === channel.slug);
    if (!exists) {
      const newChannel = {
        ...channel,
        id: channel.slug, // ensure id is slug
        addedAt: new Date().toISOString(),
        active: true
      };
      this.channels.push(newChannel);
      this.stats.activeChannels = this.channels.filter(c => c.active).length;
      this.saveChannel(newChannel); // save to DB
      this.broadcast('channelUpdate', { channels: this.channels, stats: this.stats });
    }
    return this.channels;
  }

  removeChannel(channelId) {
    const channel = this.channels.find(c => c.id === channelId || c.slug === channelId);
    if (channel) {
      this.deleteChannelDB(channel.slug); // delete from DB
    }
    this.channels = this.channels.filter(c => c.id !== channelId && c.slug !== channelId);
    this.stats.activeChannels = this.channels.filter(c => c.active).length;
    this.broadcast('channelUpdate', { channels: this.channels, stats: this.stats });
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

    this.broadcast('newModeration', { log: entry, stats: this.stats });
    return entry;
  }

  updateModerationLog(logId, updates) {
    const log = this.moderationLogs.find(l => l.id === logId);
    if (log) {
      const oldStatus = log.status;
      Object.assign(log, updates);
      
      // Update stats
      if (oldStatus === 'pending' && updates.status !== 'pending') this.stats.pending--;
      if (updates.status === 'applied' && oldStatus !== 'applied') this.stats.applied++;
      
      this.broadcast('moderationUpdate', { log, stats: this.stats });
    }
    return log;
  }

  getModerationLogs(filters = {}) {
    let logs = [...this.moderationLogs];
    if (filters.channel) logs = logs.filter(l => l.channel === filters.channel);
    if (filters.type) logs = logs.filter(l => l.type === filters.type);
    if (filters.status) logs = logs.filter(l => l.status === filters.status);
    return logs;
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
  addUserMessage(userId, message) {
    if (!this.userMessageHistory.has(userId)) {
      this.userMessageHistory.set(userId, []);
    }
    const history = this.userMessageHistory.get(userId);
    history.push({ message, timestamp: Date.now() });
    // Keep only last 30 seconds of history
    const cutoff = Date.now() - 30000;
    const filtered = history.filter(h => h.timestamp > cutoff);
    this.userMessageHistory.set(userId, filtered);
    return filtered;
  }

  getUserMessageHistory(userId) {
    return this.userMessageHistory.get(userId) || [];
  }

  // AutoMod Rules
  getAutomodRules() {
    return this.automodRules;
  }

  updateAutomodRules(updates) {
    Object.assign(this.automodRules, updates);
    this.saveRules(); // save to DB
    this.broadcast('rulesUpdate', { rules: this.automodRules });
    return this.automodRules;
  }

  updateRule(ruleName, updates) {
    if (this.automodRules.rules[ruleName]) {
      Object.assign(this.automodRules.rules[ruleName], updates);
      this.saveRules(); // save to DB
      this.broadcast('rulesUpdate', { rules: this.automodRules });
    }
    return this.automodRules;
  }

  addCustomWord(wordData) {
    const word = {
      id: `w_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      ...wordData
    };
    this.automodRules.rules.bannedWords.words.push(word);
    this.saveWord(word); // save to DB
    this.broadcast('rulesUpdate', { rules: this.automodRules });
    return word;
  }

  removeCustomWord(wordId) {
    this.automodRules.rules.bannedWords.words = this.automodRules.rules.bannedWords.words.filter(w => w.id !== wordId);
    this.deleteWordDB(wordId); // delete from DB
    this.broadcast('rulesUpdate', { rules: this.automodRules });
    return true;
  }
}

// Singleton
const store = new Store();
module.exports = store;
