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
    this.executedActions = new Set();
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
    
    // Auto-refresh if token is expired, about to expire, or if we don't know the expiry but have a refresh token
    if ((user.tokenExpiry && Date.now() > user.tokenExpiry - 60000) || (!user.tokenExpiry && user.refreshToken)) {
        console.log(`[AutoMod] Token expired/missing expiry for user ${userId}, refreshing...`);
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
    const allActive = channels.filter(c => 
      String(c.id) === logChatroomId || 
      String(c.chatroomId) === logChatroomId ||
      c.slug === (message.channel || message.chatroom_slug)
    );
    
    // Deduplicate so we don't process the same message 5 times if 5 moderators added the channel!
    // Prefer a moderator who has AutoMod enabled.
    const activeChannels = [];
    const seenSlugs = new Set();
    
    for (const c of allActive) {
        if (!seenSlugs.has(c.slug)) {
            const rules = store.getAutomodRules(c.addedBy);
            if (rules && rules.enabled) {
                seenSlugs.add(c.slug);
                activeChannels.push(c);
            }
        }
    }
    
    // Fallback: if no one has rules enabled, just pick the first one
    for (const c of allActive) {
        if (!seenSlugs.has(c.slug)) {
            seenSlugs.add(c.slug);
            activeChannels.push(c);
        }
    }
    
    if (activeChannels.length === 0) {
      return null;
    }
    
    console.log(`[AutoMod] DEBUG: Found ${activeChannels.length} active channels for ${logChatroomId}. Users: ${activeChannels.map(c => c.addedBy).join(', ')}`);
    
    // Process for each user who added the channel
    for (const channel of activeChannels) {
        const userId = channel.addedBy;
        if (!userId) {
          console.log(`[AutoMod] DEBUG: Channel ${channel.slug} has no addedBy, skipping`);
          continue;
        }
        
        const broadcasterUserId = channel.broadcasterUserId || channel.userId;
        if (broadcasterUserId && String(senderId) === String(broadcasterUserId)) {
            continue; // Kanal sahibi moderasyondan muaf
        }
        
        const rules = store.getAutomodRules(userId);
        if (!rules || !rules.enabled) {
          console.log(`[AutoMod] DEBUG: Rules disabled for user ${userId}, enabled=${rules?.enabled}`);
          continue;
        }
        
        let violations = [];

        if (rules.rules.bannedWords.enabled) {
          console.log(`[AutoMod] DEBUG: Checking banned words for user ${userId}, words count: ${rules.rules.bannedWords.words.length}, content: "${(message.content||'').substring(0,50)}"`);
          const results = this.checkBannedWords(message, rules.rules.bannedWords);
          if (results && results.length > 0) violations.push(...results);
        } else {
          console.log(`[AutoMod] DEBUG: bannedWords DISABLED for user ${userId}`);
        }

        if (rules.rules.spamDetection?.enabled) {
          const result = this.checkSpam(message, rules.rules.spamDetection, rules.rules.emoteSpam);
          if (result) violations.push(result);
        }

        if (rules.rules.emoteSpam.enabled) {
          const result = this.checkEmoteSpam(message, rules.rules.emoteSpam);
          if (result) violations.push(result);
        }

        if (violations.length === 0) continue;

        // Eger mesajda "whitelist" aksiyonlu bir kelime gectiyse, o mesajdaki tum DİĞER KELİME ihlallerini yoksay!
        // Boylece icinde yasakli kelime gecen ama aslında masum olan kelimeler (örn: yasaklı "am", masum "ama") ban yemez.
        const hasWhitelist = violations.some(v => v.action === 'whitelist');
        if (hasWhitelist) {
            console.log(`[AutoMod] Message bypassed bannedWords via whitelist: "${(message.content||'').substring(0,50)}"`);
            violations = violations.filter(v => v.ruleName !== 'bannedWords');
            if (violations.length === 0) continue;
        }

        // Her ihlali (violation) birbirinden bagimsiz olarak ishle
        for (const violation of violations) {

            let isAuto = true;
            if (violation.ruleName === 'spamDetection' || violation.ruleName === 'emoteSpam') {
                isAuto = (rules.mode === 'auto');
            }
            
            const finalStatus = (isAuto && violation.action !== 'warn') ? 'applied' : 'pending';

            const shouldLog = ['ban', 'timeout'].includes(violation.action) || 
                              ['spamDetection', 'bannedWords', 'emoteSpam'].includes(violation.ruleName);

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
              spamCount: violation.spamCount || null,
              matchedWords: violations.map(v => v.matchedWord).filter(Boolean),
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
    
    if (this.executedActions.has(logEntry.messageId)) {
        console.log(`[AutoMod] Skipping duplicate action for message ${logEntry.messageId}`);
        store.updateModerationLog(logEntry.id, { status: 'applied', appliedAt: new Date().toISOString() });
        return;
    }
    this.executedActions.add(logEntry.messageId);
    if (this.executedActions.size > 1000) {
        this.executedActions.clear();
    }

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
      
      // Fetch numeric Kick ID of the moderator
      const visitors = store.getVisitors();
      const visitor = visitors.find(v => v.username === ownerId || String(v.kickId) === String(ownerId));
      const numericOwnerId = visitor ? visitor.kickId : null;

      console.log(`[AutoMod] Action: ${logEntry.action}, User: ${logEntry.username}, Channel: ${logEntry.channel}, broadcasterUserId: ${broadcasterUserId}, ownerId: ${ownerId}, numericOwnerId: ${numericOwnerId}`);

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
                  logEntry.reason,
                  numericOwnerId || ownerId
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
                  logEntry.reason,
                  numericOwnerId || ownerId
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
      if (w.channel && w.channel !== 'all' && w.channel !== channelName) continue;
      
      let targetWord = w.word.toLowerCase().trim();
      if (!targetWord) continue;

      let matched = false;
      
      if (w.exactMatch) {
        // Escape special regex characters
        const escaped = targetWord.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        
        // Simple boundary check: target word must not be surrounded by letters/numbers
        // Check start boundary
        const idx = content.indexOf(escaped.toLowerCase !== undefined ? targetWord : targetWord);
        if (idx !== -1) {
          const before = idx > 0 ? content[idx - 1] : ' ';
          const after = idx + targetWord.length < content.length ? content[idx + targetWord.length] : ' ';
          const isWordChar = (ch) => /[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc]/.test(ch);
          if (!isWordChar(before) && !isWordChar(after)) {
            matched = true;
          }
        }
        // If indexOf didn't match (e.g. complex patterns), also try regex as backup
        if (!matched) {
          try {
            const re = new RegExp('(?:^|[^a-zA-Z0-9\\u00C0-\\u024F\\u0400-\\u04FF])(' + escaped + ')(?:$|[^a-zA-Z0-9\\u00C0-\\u024F\\u0400-\\u04FF])', 'i');
            matched = re.test(content);
          } catch(e) {
            // If even this fails, do simple includes
            matched = content.includes(targetWord);
          }
        }
      } else {
        matched = content.includes(targetWord);
      }

      if (matched) {
        console.log(`[AutoMod] BANNED WORD MATCH: "${w.word}" in "${content.substring(0, 80)}" channel=${channelName}`);
        foundViolations.push({
          ruleName: 'bannedWords',
          reason: `Yasaklı kelime tespit edildi: "${w.word}"`,
          matchedWord: w.word,
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

  checkSpam(message, spamRule, emoteSpamRule) {
    const userId = message.sender?.id || message.user_id;
    const content = message.content || message.message || '';
    const messageId = message.id || message.message_id;

    if (!userId || !content) {
      return null;
    }
    
    const history = store.addUserMessage(userId, content, messageId);
    
    const isEmoteSpamEnabled = emoteSpamRule?.enabled ?? true;
    const emoteRegex = /:[a-zA-Z0-9_]+:|\[emote:[^\]]+\]/g;
    const emojiRegex = /\p{Extended_Pictographic}/gu;
    const purelyEmotes = content.replace(emoteRegex, '').replace(emojiRegex, '').trim() === '';

    // If emoteSpam is disabled, do not flag pure-emote messages as spam
    if (!isEmoteSpamEnabled && purelyEmotes && content.trim() !== '') {
      return null;
    }
    
    // Sadece üst üste aynı mesaj kontrolü (consecutive)
    let limit = spamRule.maxRepeats || 3;
    if (purelyEmotes && content.trim() !== '') {
      limit = emoteSpamRule?.maxRepeats || 3;
    }
    
    const windowSize = 5;

    if (history.length >= limit) {
      const recentMessages = history.slice(-windowSize);
      let count = 0;
      const now = Date.now();
      const timeWindow = 30000; // 30 saniye içinde
      
      for (const msg of recentMessages) {
        if (msg.message === content && (now - msg.timestamp) < timeWindow) {
          count++;
        }
      }

      if (count >= limit) {
        return {
          ruleName: purelyEmotes ? 'emoteSpam' : 'spamDetection',
          action: purelyEmotes ? (emoteSpamRule?.action && emoteSpamRule.action !== 'delete' ? emoteSpamRule.action : 'timeout') : (spamRule.action || 'timeout'),
          duration: purelyEmotes ? (emoteSpamRule?.duration || 5) : (spamRule.duration || 5),
          reason: purelyEmotes ? `Emote Spam (${count}x aynı mesaj)` : `Spam (${count}x aynı mesaj)`,
          messageContent: content,
          spamCount: count
        };
      }
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
