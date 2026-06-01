/**
 * Kick AutoMod Dashboard - AutoMod Engine
 * Rule-based automatic moderation system
 */

const store = require('./store');
const { createKickClient } = require('./kickApi');

class AutoModEngine {
  constructor() {
    // Singleton state removed for SaaS architecture.
    // Each action fetches the required user token from store/db.
  }

  // Backwards compatibility for middleware
  setAdminUserId(userId) {
     // No-op for SaaS architecture
  }

  setAccessToken(token) {
    // No-op for SaaS architecture
  }

  setKickClient(client) {
    // No-op
  }

  _getClient(userId) {
    const visitors = store.getVisitors();
    const user = visitors.find(v => v.kickId === userId || v.id === userId);
    if (!user || !user.accessToken) return null;
    return createKickClient(user.accessToken);
  }

  get hasClient() {
    return true; // Assume true, validated per user
  }

  // Keep old property for compatibility with middleware check
  get kickClient() {
    return true; // SaaS: tokens are per-user, not singleton
  }

  /**
   * Process an incoming chat message against all automod rules
   */
  async processMessage(message) {
    const senderId = message.sender?.id || message.user_id;
    const logChatroomId = String(message.chatroom_id || message.chatroomId);
    
    // Find all unique users who added this channel
    const channels = store.getChannels();
    const activeChannels = channels.filter(c => 
      String(c.id) === logChatroomId || 
      String(c.chatroomId) === logChatroomId ||
      c.slug === (message.channel || message.chatroom_slug)
    );
    
    if (activeChannels.length === 0) return null;
    
    // Process for each user who added the channel
    for (const channel of activeChannels) {
        const userId = channel.addedBy;
        if (!userId) continue;
        
        const broadcasterUserId = channel.broadcasterUserId || channel.userId;
        if (broadcasterUserId && String(senderId) === String(broadcasterUserId)) {
            continue; // Kanal sahibi moderasyondan muaf
        }
        
        const rules = store.getAutomodRules(userId);
        if (!rules || !rules.enabled) continue;
        
        const violations = [];

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

        if (violations.length === 0) continue;

        let primaryViolation;
        const bannedWordViolation = violations.find(v => v.ruleName === 'bannedWords');
        
        if (bannedWordViolation) {
          primaryViolation = bannedWordViolation;
        } else {
          const severity = { 'ban': 3, 'timeout': 2, 'delete': 1, 'warn': 0 };
          violations.sort((a, b) => (severity[b.action] || 0) - (severity[a.action] || 0));
          primaryViolation = violations[0];
        }

        let isAuto = true;
        if (primaryViolation.ruleName === 'spamDetection') {
            isAuto = (rules.mode === 'auto');
        }
        
        const finalStatus = (isAuto && primaryViolation.action !== 'warn') ? 'applied' : 'pending';

        const shouldLog = ['ban', 'timeout'].includes(primaryViolation.action) || 
                          ['spamDetection', 'bannedWords'].includes(primaryViolation.ruleName);

        if (!shouldLog) {
          if (isAuto && primaryViolation.action === 'delete') {
            const client = this._getClient(userId);
            if (client) {
               client.deleteMessage(message.id || message.message_id).catch(err => {
                 console.error(`[AutoMod] Sessiz silme başarısız:`, err.message);
               });
            }
          }
          continue;
        }

        const logEntry = store.addModerationLog({
          ownerId: userId, // YENİ: Hangi kullanıcının kurallarına göre işlem yapıldığını kaydet
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

        if (isAuto && primaryViolation.action !== 'warn') {
          await this.applyAction(logEntry, userId);
        }
    }
  }

  /**
   * Apply a moderation action via Kick API
   */
  async applyAction(logEntry, userId) {
    const ownerId = userId || logEntry.ownerId;
    const client = this._getClient(ownerId);
    if (!client) {
      console.warn(`[AutoMod] No Kick client available for user ${ownerId} - token missing`);
      store.updateModerationLog(logEntry.id, { status: 'error', error: 'API token not available for this user' });
      return;
    }

    try {
      const channels = store.getChannels();
      const logChatroomId = String(logEntry.chatroomId);
      
      const channel = channels.find(c => 
        String(c.id) === logChatroomId || 
        String(c.chatroomId) === logChatroomId ||
        c.slug === logEntry.channel
      );
      
      const broadcasterUserId = channel ? (channel.broadcasterUserId || channel.userId) : null;
      console.log(`[AutoMod] Action: ${logEntry.action}, User: ${logEntry.username}, Channel: ${logEntry.channel}, broadcasterUserId: ${broadcasterUserId}, ownerId: ${ownerId}`);

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
      console.log(`[AutoMod] ✅ Action applied: ${logEntry.action} on ${logEntry.username} by owner ${ownerId}`);
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
