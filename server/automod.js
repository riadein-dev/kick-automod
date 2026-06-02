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

  async _refreshToken(user) {
    if (!user.refreshToken) return false;
    try {
      const KICK_TOKEN_URL = 'https://id.kick.com/oauth/token';
      const response = await fetch(KICK_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: process.env.KICK_CLIENT_ID,
          client_secret: process.env.KICK_CLIENT_SECRET,
          refresh_token: user.refreshToken
        }).toString()
      });
      if (!response.ok) return false;
      const data = await response.json();
      // Update visitor store with new tokens
      user.accessToken = data.access_token;
      user.refreshToken = data.refresh_token || user.refreshToken;
      user.tokenExpiry = Date.now() + (data.expires_in * 1000);
      store.addVisitor({ kickId: user.kickId, accessToken: user.accessToken, refreshToken: user.refreshToken, tokenExpiry: user.tokenExpiry });
      console.log(`[AutoMod] Token auto-refreshed for user ${user.kickId}`);
      return true;
    } catch (err) {
      console.error(`[AutoMod] Token refresh failed for user ${user.kickId}:`, err.message);
      return false;
    }
  }

  async _getClient(userId) {
    const visitors = store.getVisitors();
    const strUserId = String(userId);
    const user = visitors.find(v => 
        String(v.kickId) === strUserId || 
        String(v.id) === strUserId || 
        (v.username && String(v.username) === strUserId)
    );
    
    if (!user) {
        console.warn(`[AutoMod] _getClient: User not found in visitors list for userId=${userId}`);
        return null;
    }
    if (!user.accessToken) {
        console.warn(`[AutoMod] _getClient: User found but no accessToken for userId=${userId}`);
        return null;
    }
    
    // Auto-refresh if token is expired or about to expire (within 60 seconds)
    if (user.tokenExpiry && Date.now() > user.tokenExpiry - 60000) {
        console.log(`[AutoMod] Token expired/expiring for user ${userId}, refreshing...`);
        const refreshed = await this._refreshToken(user);
        if (!refreshed) {
            console.warn(`[AutoMod] Token refresh failed, using existing token for userId=${userId}`);
        }
    }
    
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
        
        let violations = [];

        if (rules.rules.bannedWords.enabled) {
          const results = this.checkBannedWords(message, rules.rules.bannedWords);
          if (results && results.length > 0) violations.push(...results);
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

        // Her ihlali (violation) birbirinden bagimsiz olarak ishle
        for (const violation of violations) {
            let isAuto = true;
            if (violation.ruleName === 'spamDetection') {
                isAuto = (rules.mode === 'auto');
            }
            
            const finalStatus = (isAuto && violation.action !== 'warn') ? 'applied' : 'pending';

            const shouldLog = ['ban', 'timeout'].includes(violation.action) || 
                              ['spamDetection', 'bannedWords'].includes(violation.ruleName);

            if (!shouldLog) {
              if (isAuto && violation.action === 'delete') {
                const client = await this._getClient(userId);
                if (client) {
                   client.deleteMessage(message.id || message.message_id).catch(err => {
                     console.error(`[AutoMod] Sessiz silme basarisiz:`, err.message);
                   });
                }
              }
              continue;
            }

            const logEntry = store.addModerationLog({
              ownerId: userId,
              userId: message.sender?.id || message.user_id,
              username: message.sender?.username || message.username || 'Unknown',
              channel: message.channel || message.chatroom_slug || 'Unknown',
              chatroomId: message.chatroom_id,
              messageId: message.id || message.message_id,
              messageContent: message.content || message.message,
              reason: violation.reason,
              ruleName: violation.ruleName,
              type: 'auto',
              action: violation.action,
              duration: violation.duration || 0,
              status: finalStatus,
              allViolations: violations.map(v => v.reason)
            });

            if (isAuto && violation.action !== 'warn') {
              await this.applyAction(logEntry, userId);
            }
        }
    }
  }

  /**
   * Apply a moderation action via Kick API
   */
  async applyAction(logEntry, userId) {
    const ownerId = userId || logEntry.ownerId;
    const client = await this._getClient(ownerId);
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
    let foundViolations = [];
    
    for (const w of rule.words) {
      if (w.channel && w.channel !== 'all' && w.channel !== channelName) continue; // Check channel match
      
      // Trim the target word to prevent accidental leading/trailing spaces
      let targetWord = w.word.toLowerCase().trim();
      if (!targetWord) continue;

      let matched = false;
      
      if (w.exactMatch) {
        // Escape special regex characters in the target word
        const escapedWord = targetWord.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
        
        // Use unicode-aware boundaries to perfectly match non-letters/numbers
        try {
            const regex = new RegExp(`(?:^|[^\\\\p{L}\\\\p{N}])(${escapedWord})(?:$|[^\\\\p{L}\\\\p{N}])`, 'iu');
            matched = regex.test(content);
        } catch (e) {
            try {
              // Fallback for older environments
              const fallbackRegex = new RegExp(`(?:^|\\\\s|[.,!?;:'"\\\\(\\\\)\[\\\\]\\\\{\\\\}<>])(${escapedWord})(?:$|\\\\s|[.,!?;:'"\\\\(\\\\)\[\\\\]\\\\{\\\\}<>])`, 'i');
              matched = fallbackRegex.test(content);
            } catch(e2) {
              // Ignore invalid regex errors
              require('fs').appendFileSync('error.log', `Regex error: ${e2.message} for word ${w.word}\\n`);
            }
        }
      } else {
        matched = content.includes(targetWord);
      }

      if (matched) {
        foundViolations.push({
          ruleName: 'bannedWords',
          reason: `Yasaklı kelime tespit edildi: "${w.word}"`,
          action: w.action,
          duration: w.duration
        });
      }
    }

    // Check custom regex patterns
    for (const pattern of (rule.customPatterns || [])) {
      try {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(content)) {
          foundViolations.push({
            ruleName: 'bannedWords',
            reason: `Yasaklı pattern tespit edildi: "${pattern}"`,
            action: rule.action,
            duration: rule.duration
          });
        }
      } catch (e) { /* invalid regex, skip */ }
    }

    return foundViolations;
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
    // Artık kullanıcı panelden bu ayarları (timeWindow, maxRepeats) dinamik olarak değiştirebilir.
    // Varsayılan olarak timeWindow: 10, maxRepeats: 3 kullanıyoruz (eğer veritabanında eski ayar varsa veya yoksa düzeltiyoruz)
    const activeTimeWindow = rule.timeWindow || 10; 
    const limit = rule.maxRepeats || 3;

    const recentMessages = history.filter(h => h.timestamp > Date.now() - (activeTimeWindow * 1000));
    const duplicates = recentMessages.filter(h => h.message === content);
    
    if (duplicates.length >= limit) {
      return {
        ruleName: 'spamDetection',
        reason: `Spam tespit edildi: ${duplicates.length}x aynı mesaj (${activeTimeWindow}sn içinde)`,
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
