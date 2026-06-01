/**
 * Kick AutoMod Dashboard - AutoMod Engine
 * Rule-based automatic moderation system
 */

const store = require('./store');
const { createKickClient } = require('./kickApi');

class AutoModEngine {
  constructor() {
    this._accessToken = null;
    this._adminUserId = null;
  }

  setAdminUserId(userId) {
    this._adminUserId = userId;
  }

  /**
   * Store the access token so we can create a kickClient on demand.
   * This survives across WebSocket events unlike the old approach.
   */
  setAccessToken(token) {
    this._accessToken = token;
  }

  /** Backwards-compatible: also accept a kickClient and extract nothing, just store token */
  setKickClient(client) {
    // Extract token from client if possible
    if (client && client.accessToken) {
      this._accessToken = client.accessToken;
    }
  }

  /** Get or create a kickClient on demand */
  _getClient() {
    if (!this._accessToken) {
      return null;
    }
    return createKickClient(this._accessToken);
  }

  get hasClient() {
    return !!this._accessToken;
  }

  // Keep old property for compatibility with middleware check
  get kickClient() {
    return this._accessToken ? true : null;
  }

  /**
   * Process an incoming chat message against all automod rules
   */
  async processMessage(message) {
    const rules = store.getAutomodRules();
    if (!rules.enabled) return null;
    
    const senderId = message.sender?.id || message.user_id;
    
    // YÖNETİCİ/YAYINCI KORUMASI: Sistem sahibini veya kanal sahibini asla algılama
    if (this._adminUserId && String(senderId) === String(this._adminUserId)) {
        return null;
    }
    
    const channels = store.getChannels();
    const logChatroomId = String(message.chatroom_id || message.chatroomId);
    const channel = channels.find(c => 
      String(c.id) === logChatroomId || 
      String(c.chatroomId) === logChatroomId ||
      c.slug === (message.channel || message.chatroom_slug)
    );
    const broadcasterUserId = channel ? (channel.broadcasterUserId || channel.userId) : null;
    
    if (broadcasterUserId && String(senderId) === String(broadcasterUserId)) {
        return null; // Kanal sahibi de moderasyondan muaf
    }

    const violations = [];

    // Check each rule
    if (rules.rules.bannedWords.enabled) {
      const result = this.checkBannedWords(message, rules.rules.bannedWords);
      if (result) violations.push(result);
    }

    if (rules.rules.spamDetection.enabled) {
      const result = this.checkSpam(message, rules.rules.spamDetection);
      if (result) violations.push(result);
    }



    if (rules.rules.emoteSpam.enabled) {
      const result = this.checkEmoteSpam(message, rules.rules.emoteSpam);
      if (result) violations.push(result);
    }

    if (violations.length === 0) return null;

    // Özel İstenen Davranış: Eğer yasaklı kelime varsa, diğer tüm kuralları (spam dahil) ezmeli.
    // Çünkü kullanıcı o kelime için özel bir ceza belirledi, spam kuralının otomatik Ban'ı bunu ezmemeli.
    let primaryViolation;
    const bannedWordViolation = violations.find(v => v.ruleName === 'bannedWords');
    
    if (bannedWordViolation) {
      primaryViolation = bannedWordViolation;
    } else {
      // Get the most severe violation
      const severity = { 'ban': 3, 'timeout': 2, 'delete': 1, 'warn': 0 };
      violations.sort((a, b) => (severity[b.action] || 0) - (severity[a.action] || 0));
      primaryViolation = violations[0];
    }

    // Sadece spam için manuel/oto modunu dikkate al. Diğerleri her zaman otomatik işler.
    let isAuto = true;
    if (primaryViolation.ruleName === 'spamDetection') {
        isAuto = (rules.mode === 'auto');
    }
    
    const finalStatus = (isAuto && primaryViolation.action !== 'warn') ? 'applied' : 'pending';

    // Kullanıcı İsteği: "Sadece eylem uygulanan (ban/timeout) veya spam/yasaklı kelime kaydedilsin"
    // CapsLock, Link, EmoteSpam gibi kuralların sadece 'delete' işlemi varsa logu kirletmemesi için:
    const shouldLog = ['ban', 'timeout'].includes(primaryViolation.action) || 
                      ['spamDetection', 'bannedWords'].includes(primaryViolation.ruleName);

    if (!shouldLog) {
      // Loglamadan sadece sessizce işlemi yap
      if (isAuto && primaryViolation.action === 'delete') {
        const client = this._getClient();
        if (client) {
           client.deleteMessage(message.id || message.message_id).catch(err => {
             console.error(`[AutoMod] Sessiz silme başarısız:`, err.message);
           });
        }
      }
      return null;
    }

    // Create moderation log entry
    const logEntry = store.addModerationLog({
      userId: message.sender?.id || message.user_id,
      username: message.sender?.username || message.username || 'Unknown',
      channel: message.channel || message.chatroom_slug || 'Unknown',
      chatroomId: message.chatroom_id,
      messageId: message.id || message.message_id,
      messageContent: message.content || message.message,
      reason: primaryViolation.reason,
      ruleName: primaryViolation.ruleName,
      type: 'auto',
      action: primaryViolation.action,
      duration: primaryViolation.duration || 0,
      status: finalStatus,
      allViolations: violations.map(v => v.reason)
    });

    // If auto mode for this rule, apply action immediately (except for 'warn' which stays pending)
    if (isAuto && primaryViolation.action !== 'warn') {
      await this.applyAction(logEntry);
    }

    return logEntry;
  }

  /**
   * Apply a moderation action via Kick API
   */
  async applyAction(logEntry) {
    const client = this._getClient();
    if (!client) {
      console.warn('[AutoMod] No Kick client available for moderation action - token missing');
      store.updateModerationLog(logEntry.id, { status: 'error', error: 'API token not available' });
      return;
    }

    try {
      // Esnek kanal eşleştirme: chatroomId, id veya slug ile ara
      const channels = store.getChannels();
      const logChatroomId = String(logEntry.chatroomId);
      
      const channel = channels.find(c => 
        String(c.id) === logChatroomId || 
        String(c.chatroomId) === logChatroomId ||
        c.slug === logEntry.channel
      );
      
      const broadcasterUserId = channel ? (channel.broadcasterUserId || channel.userId) : null;
      console.log(`[AutoMod] Action: ${logEntry.action}, User: ${logEntry.username}, Channel: ${logEntry.channel}, broadcasterUserId: ${broadcasterUserId}`);

      if (!broadcasterUserId && logEntry.action !== 'delete') {
        throw new Error(`Broadcaster User ID not found for channel ${logEntry.channel}`);
      }

      switch (logEntry.action) {
        case 'delete':
          if (logEntry.messageId) {
            await client.deleteMessage(logEntry.messageId);
          }
          break;
        case 'timeout':
          if (broadcasterUserId && logEntry.userId) {
            const promises = [
              client.timeoutUser(
                broadcasterUserId,
                logEntry.userId,
                logEntry.duration || 5,
                logEntry.reason
              )
            ];
            if (logEntry.messageId) {
              promises.push(client.deleteMessage(logEntry.messageId).catch(() => {}));
            }
            await Promise.all(promises);
          } else {
            throw new Error(`Missing data for timeout: broadcasterUserId=${broadcasterUserId}, userId=${logEntry.userId}`);
          }
          break;
        case 'ban':
          if (broadcasterUserId && logEntry.userId) {
            const promises = [
              client.banUser(
                broadcasterUserId,
                logEntry.userId,
                logEntry.reason
              )
            ];
            if (logEntry.messageId) {
              promises.push(client.deleteMessage(logEntry.messageId).catch(() => {}));
            }
            await Promise.all(promises);
          } else {
            throw new Error(`Missing data for ban: broadcasterUserId=${broadcasterUserId}, userId=${logEntry.userId}`);
          }
          break;
      }
      
      store.updateModerationLog(logEntry.id, { status: 'applied', appliedAt: new Date().toISOString() });
      console.log(`[AutoMod] ✅ Action applied: ${logEntry.action} on ${logEntry.username} - ${logEntry.reason}`);
    } catch (err) {
      console.error(`[AutoMod] ❌ Failed to apply action:`, err.message);
      store.updateModerationLog(logEntry.id, { status: 'error', error: err.message });
    }
  }

  // ============ Rule Checks ============

  checkBannedWords(message, rule) {
    const content = (message.content || message.message || '').toLowerCase();
    const channelName = message.channel || message.chatroom_slug;
    
    for (const w of rule.words) {
      if (w.channel && w.channel !== 'all' && w.channel !== channelName) continue; // Check channel match
      
      const targetWord = w.word.toLowerCase();
      let matched = false;
      
      if (w.exactMatch) {
        // match word boundaries
        const regex = new RegExp(`(?:^|\\s|[.,!?;:])(${targetWord})(?:$|\\s|[.,!?;:])`, 'i');
        matched = regex.test(content);
      } else {
        matched = content.includes(targetWord);
      }

      if (matched) {
        return {
          ruleName: 'bannedWords',
          reason: `Yasaklı kelime tespit edildi: "${w.word}"`,
          action: w.action,
          duration: w.duration
        };
      }
    }

    // Check custom regex patterns
    for (const pattern of (rule.customPatterns || [])) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(content)) {
          return {
            ruleName: 'bannedWords',
            reason: `Yasaklı pattern tespit edildi: "${pattern}"`,
            action: rule.action,
            duration: rule.duration
          };
        }
      } catch (e) { /* invalid regex, skip */ }
    }

    return null;
  }

  checkSpam(message, rule) {
    const userId = message.sender?.id || message.user_id;
    if (!userId) return null;

    const content = message.content || message.message || '';
    
    // If emoteSpam is disabled, do not flag pure-emote messages as spam
    const globalRules = store.getAutomodRules();
    if (!globalRules.rules.emoteSpam.enabled) {
      const emoteRegex = /:[a-zA-Z0-9_]+:|\[emote:[^\]]+\]/g;
      const purelyEmotes = content.replace(emoteRegex, '').trim() === '';
      if (purelyEmotes && content.trim() !== '') {
        return null;
      }
    }

    const history = store.addUserMessage(userId, content);
    
    // Check for repeated messages
    const recentMessages = history.filter(h => h.timestamp > Date.now() - (rule.timeWindow * 1000));
    const duplicates = recentMessages.filter(h => h.message === content);
    
    if (duplicates.length >= rule.maxRepeats) {
      return {
        ruleName: 'spamDetection',
        reason: `Spam tespit edildi: ${duplicates.length}x aynı mesaj (${rule.timeWindow}sn içinde)`,
        action: rule.action,
        duration: rule.duration
      };
    }

    // Check for message flood
    const oneMinuteAgo = Date.now() - 60000;
    const recentCount = history.filter(h => h.timestamp > oneMinuteAgo).length;
    
    if (recentCount >= rule.maxMessagesPerMinute) {
      return {
        ruleName: 'spamDetection',
        reason: `Mesaj taşması: ${recentCount} mesaj/dakika (limit: ${rule.maxMessagesPerMinute})`,
        action: rule.action,
        duration: rule.duration
      };
    }

    return null;
  }



  checkEmoteSpam(message, rule) {
    const content = message.content || message.message || '';
    // Match emote patterns like :emote_name: or [emote:id:name]
    const emoteRegex = /:[a-zA-Z0-9_]+:|\[emote:[^\]]+\]/g;
    const emotes = content.match(emoteRegex);
    
    if (emotes && emotes.length >= rule.maxEmotes) {
      return {
        ruleName: 'emoteSpam',
        reason: `Emote spam tespit edildi: ${emotes.length} emote (limit: ${rule.maxEmotes})`,
        action: rule.action,
        duration: rule.duration
      };
    }

    return null;
  }
}

// Singleton
const automod = new AutoModEngine();
module.exports = automod;
