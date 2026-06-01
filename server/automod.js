/**
 * Kick AutoMod Dashboard - AutoMod Engine
 * Rule-based automatic moderation system
 */

const store = require('./store');

class AutoModEngine {
  constructor() {
    this.kickClient = null;
  }

  setKickClient(client) {
    this.kickClient = client;
  }

  /**
   * Process an incoming chat message against all automod rules
   */
  async processMessage(message) {
    const rules = store.getAutomodRules();
    if (!rules.enabled) return null;

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

    if (rules.rules.linkBlocking.enabled) {
      const result = this.checkLinks(message, rules.rules.linkBlocking);
      if (result) violations.push(result);
    }

    if (rules.rules.capsLock.enabled) {
      const result = this.checkCapsLock(message, rules.rules.capsLock);
      if (result) violations.push(result);
    }

    if (rules.rules.emoteSpam.enabled) {
      const result = this.checkEmoteSpam(message, rules.rules.emoteSpam);
      if (result) violations.push(result);
    }

    if (violations.length === 0) return null;

    // Get the most severe violation
    const severity = { 'ban': 3, 'timeout': 2, 'delete': 1 };
    violations.sort((a, b) => (severity[b.action] || 0) - (severity[a.action] || 0));
    const primaryViolation = violations[0];

    // Sadece spam için manuel/oto modunu dikkate al. Diğerleri her zaman otomatik işler.
    let isAuto = true;
    if (primaryViolation.ruleName === 'spamDetection') {
        isAuto = (rules.mode === 'auto');
    }
    
    const finalStatus = (isAuto && primaryViolation.action !== 'warn') ? 'applied' : 'pending';

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
    if (isAuto && this.kickClient && primaryViolation.action !== 'warn') {
      await this.applyAction(logEntry);
    }

    return logEntry;
  }

  /**
   * Apply a moderation action via Kick API
   */
  async applyAction(logEntry) {
    if (!this.kickClient) {
      console.warn('[AutoMod] No Kick client available for moderation action');
      return;
    }

    try {
      // Esnek kanal eşleştirme: chatroomId, id veya slug ile ara
      const channels = store.getChannels();
      console.log(`[AutoMod] Looking for channel. chatroomId=${logEntry.chatroomId}, Available channels:`, channels.map(c => ({ id: c.id, slug: c.slug, chatroomId: c.chatroomId, broadcasterUserId: c.broadcasterUserId })));
      
      const channel = channels.find(c => 
        String(c.id) === String(logEntry.chatroomId) || 
        String(c.chatroomId) === String(logEntry.chatroomId) ||
        c.slug === logEntry.channel
      );
      
      const broadcasterUserId = channel ? (channel.broadcasterUserId || channel.userId) : null;
      console.log(`[AutoMod] Channel found: ${!!channel}, broadcasterUserId: ${broadcasterUserId}, action: ${logEntry.action}`);

      switch (logEntry.action) {
        case 'delete':
          if (logEntry.messageId) {
            await this.kickClient.deleteMessage(logEntry.messageId);
          }
          break;
        case 'timeout':
          if (broadcasterUserId && logEntry.userId) {
            const promises = [
              this.kickClient.timeoutUser(
                broadcasterUserId,
                logEntry.userId,
                logEntry.duration || 5,
                logEntry.reason
              )
            ];
            if (logEntry.messageId) {
              promises.push(this.kickClient.deleteMessage(logEntry.messageId).catch(() => {}));
            }
            await Promise.all(promises);
          } else {
            console.error(`[AutoMod] Missing data for timeout: broadcasterUserId=${broadcasterUserId}, userId=${logEntry.userId}`);
          }
          break;
        case 'ban':
          if (broadcasterUserId && logEntry.userId) {
            const promises = [
              this.kickClient.banUser(
                broadcasterUserId,
                logEntry.userId,
                logEntry.reason
              )
            ];
            if (logEntry.messageId) {
              promises.push(this.kickClient.deleteMessage(logEntry.messageId).catch(() => {}));
            }
            await Promise.all(promises);
          } else {
            console.error(`[AutoMod] Missing data for ban: broadcasterUserId=${broadcasterUserId}, userId=${logEntry.userId}`);
          }
          break;
      }
      
      store.updateModerationLog(logEntry.id, { status: 'applied', appliedAt: new Date().toISOString() });
      console.log(`[AutoMod] Action applied: ${logEntry.action} on ${logEntry.username} - ${logEntry.reason}`);
    } catch (err) {
      console.error(`[AutoMod] Failed to apply action:`, err.message);
      store.updateModerationLog(logEntry.id, { status: 'error', error: err.message });
    }
  }

  // ============ Rule Checks ============

  checkBannedWords(message, rule) {
    const content = (message.content || message.message || '').toLowerCase();
    const channelName = message.channel || message.chatroom_slug;
    
    for (const w of rule.words) {
      if (w.channel && w.channel !== channelName) continue; // Check channel match
      
      const targetWord = w.word.toLowerCase();
      let matched = false;
      
      if (w.exactMatch) {
        // match word boundaries
        // JavaScript regex \b doesn't work well with non-ASCII. We use a simple approximation for exact word.
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

  checkLinks(message, rule) {
    const content = message.content || message.message || '';
    const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
    const urls = content.match(urlRegex);
    
    if (!urls || urls.length === 0) return null;

    if (rule.blockAll) {
      return {
        ruleName: 'linkBlocking',
        reason: `Link engellendi: Tüm linkler yasaklı`,
        action: rule.action,
        duration: rule.duration
      };
    }

    for (const url of urls) {
      let hostname;
      try {
        hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
      } catch {
        hostname = url;
      }

      const isAllowed = rule.allowedDomains.some(domain => 
        hostname === domain || hostname.endsWith(`.${domain}`)
      );

      if (!isAllowed) {
        return {
          ruleName: 'linkBlocking',
          reason: `İzinsiz link tespit edildi: ${hostname}`,
          action: rule.action,
          duration: rule.duration
        };
      }
    }

    return null;
  }

  checkCapsLock(message, rule) {
    const content = message.content || message.message || '';
    if (content.length < rule.minLength) return null;

    const letters = content.replace(/[^a-zA-ZçÇğĞıİöÖşŞüÜ]/g, '');
    if (letters.length === 0) return null;

    const upperCase = letters.replace(/[^A-ZÇĞİÖŞÜ]/g, '');
    const percentage = (upperCase.length / letters.length) * 100;

    if (percentage >= rule.threshold) {
      return {
        ruleName: 'capsLock',
        reason: `Aşırı büyük harf kullanımı: %${Math.round(percentage)} (limit: %${rule.threshold})`,
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
