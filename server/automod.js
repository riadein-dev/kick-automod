/**
 * Kick AutoMod Dashboard - AutoMod Engine
 * Rule-based automatic moderation system
 */

const store = require('./store');
const { createKickClient } = require('./kickApi');

class AutoModEngine {
  constructor() {
    // Singleton state removed for SaaS architecture.
    // Dedup sets to prevent duplicate actions
    this.processedMessages = new Map();
    this.executedActions = new Set();
    this.recentTimeouts = new Map(); // "chatroomId:userId" -> timestamp
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
    if (!user.refreshToken) {
      console.warn(`[AutoMod] No refresh token for user ${user.kickId || user.username}`);
      return false;
    }
    try {
      const KICK_TOKEN_URL = 'https://id.kick.com/oauth/token';
      console.log(`[AutoMod] Attempting token refresh for user ${user.kickId || user.username}...`);
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
      if (!response.ok) {
        const errText = await response.text();
        console.error(`[AutoMod] Token refresh HTTP ${response.status} for user ${user.kickId}: ${errText}`);
        return false;
      }
      const data = await response.json();
      // Update visitor store with new tokens
      user.accessToken = data.access_token;
      user.refreshToken = data.refresh_token || user.refreshToken;
      user.tokenExpiry = Date.now() + (data.expires_in * 1000);
      store.addVisitor({ kickId: user.kickId, username: user.username, accessToken: user.accessToken, refreshToken: user.refreshToken, tokenExpiry: user.tokenExpiry });
      console.log(`[AutoMod] ✅ Token refreshed for user ${user.kickId || user.username} (expires in ${data.expires_in}s)`);
      return true;
    } catch (err) {
      console.error(`[AutoMod] ❌ Token refresh failed for user ${user.kickId}:`, err.message);
      return false;
    }
  }

  /**
   * Refresh all expired/near-expiry tokens proactively
   * Called on startup and periodically
   */
  async refreshAllTokens() {
    const visitors = store.getVisitors();
    const now = Date.now();
    let refreshed = 0;
    let failed = 0;
    let skipped = 0;

    console.log(`[AutoMod] 🔄 Starting token refresh cycle for ${visitors.length} users...`);

    for (const user of visitors) {
      if (!user.refreshToken) {
        skipped++;
        continue;
      }
      if (user.isBanned) {
        skipped++;
        continue;
      }

      // Refresh if expired, about to expire (within 5 min), or no expiry set
      const needsRefresh = !user.tokenExpiry || (now > user.tokenExpiry - 300000);
      
      if (!needsRefresh) {
        skipped++;
        continue;
      }

      try {
        const success = await this._refreshToken(user);
        if (success) {
          refreshed++;
        } else {
          failed++;
        }
        // Rate limit: wait 500ms between refreshes to avoid hammering Kick API
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        failed++;
        console.error(`[AutoMod] Token refresh error for ${user.kickId}:`, err.message);
      }
    }

    console.log(`[AutoMod] 🔄 Token refresh complete: ${refreshed} refreshed, ${failed} failed, ${skipped} skipped`);
    return { refreshed, failed, skipped };
  }

  /**
   * Start periodic token refresh (every 30 minutes)
   */
  startTokenRefreshInterval() {
    // Initial refresh after 10 seconds (give DB time to load)
    setTimeout(() => {
      this.refreshAllTokens().catch(err => {
        console.error('[AutoMod] Initial token refresh failed:', err.message);
      });
    }, 10000);

    // Periodic refresh every 30 minutes
    this._tokenRefreshInterval = setInterval(() => {
      this.refreshAllTokens().catch(err => {
        console.error('[AutoMod] Periodic token refresh failed:', err.message);
      });
    }, 30 * 60 * 1000);

    console.log('[AutoMod] ⏰ Token refresh interval started (every 30 min)');
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
    const messageId = message.id || message.message_id;

    // Dedup global kontrol
    const globalDedupKey = `${logChatroomId}:${messageId}`;
    if (this.processedMessages.has(globalDedupKey)) {
        return; // zaten işlendi
    }
    this.processedMessages.set(globalDedupKey, Date.now());
    
    // Temizlik
    if (this.processedMessages.size > 5000) {
        this.processedMessages.clear();
    }
    
    // Find all unique users who added this channel
    const channels = store.getChannels();
    const allActive = channels.filter(c => 
      String(c.id) === logChatroomId || 
      String(c.chatroomId) === logChatroomId ||
      c.slug === (message.channel || message.chatroom_slug)
    );
    
    // Allow each user who added this channel to have their rules checked independently
    // Only dedup per user+slug combo (prevent same user processing same channel twice)
    const activeChannels = [];
    const seenUserSlugs = new Set();
    
    for (const c of allActive) {
        const key = `${c.addedBy}:${c.slug}`;
        if (!seenUserSlugs.has(key) && c.addedBy) {
            seenUserSlugs.add(key);
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
        
        // Banned visitor check - CRITICAL FIX
        const visitors = store.getVisitors();
        // Check by username (userId), internal id, or kickId
        const visitor = visitors.find(v => v.username === userId || v.id === userId || String(v.kickId) === String(userId));
        if (visitor && visitor.isBanned) {
            console.log(`[AutoMod] DEBUG: User ${userId} is BANNED from the system. Skipping their rules.`);
            continue;
        }
        
        // Moderatör kontrolü - ama targetUsername ile hedeflenmiş moddalar muaf DEĞİL
        const badges = message.sender?.identity?.badges || [];
        const isMod = badges.some(b => b.type === 'moderator');
        const senderUsername = (message.sender?.username || message.username || '').toLowerCase();
        
        // Check if this sender is specifically targeted by username
        const rules = store.getAutomodRules(userId);
        const hasTargetRule = rules?.rules?.bannedWords?.words?.some(w => 
            w.targetUsername && w.targetUsername.toLowerCase().trim() === senderUsername && w.enabled !== false
        );
        
        if (isMod && !hasTargetRule) {
            continue; // Genel kurallar için mod muafiyeti
        }
        
        if (!rules || !rules.enabled) {
          console.log(`[AutoMod] DEBUG: Rules disabled for user ${userId}, enabled=${rules?.enabled}`);
          continue;
        }
        
        // CRITICAL: Skip if user is not online (browser/site closed)
        if (!store.isUserOnline(userId)) {
          console.log(`[AutoMod] DEBUG: User ${userId} is OFFLINE (site closed). Skipping their rules.`);
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

        // Mod ise sadece targetUsername ihlallerini tut (genel kelime kuralları modlara uygulanmaz)
        if (isMod) {
            violations = violations.filter(v => v.reason && v.reason.includes('Hedef kullanıcı'));
            if (violations.length === 0) continue;
        }

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

            const shouldLog = ['ban', 'timeout', 'delete'].includes(violation.action) || 
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
    
    // User-level cooldown (10 saniye) to prevent double timeouts for spamming
    const userTimeoutKey = `${logEntry.chatroomId}:${logEntry.userId}`;
    if (['timeout', 'ban'].includes(logEntry.action)) {
        const lastAction = this.recentTimeouts.get(userTimeoutKey);
        if (lastAction && (Date.now() - lastAction) < 10000) {
            console.log(`[AutoMod] Skipping duplicate action for user ${logEntry.userId} (cooldown)`);
            store.updateModerationLog(logEntry.id, { status: 'applied', appliedAt: new Date().toISOString() });
            return;
        }
        this.recentTimeouts.set(userTimeoutKey, Date.now());
        
        // Temizlik
        if (this.recentTimeouts.size > 5000) {
            this.recentTimeouts.clear();
        }
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
              console.log(`[AutoMod] Timeout via API (no moderator_user_id to prevent double): ${logEntry.username}`);
              require('./websocket').registerSiteAction(logEntry.userId);
              await client.timeoutUser(
                broadcasterUserId,
                logEntry.userId,
                logEntry.duration || 5,
                logEntry.reason
              );
          } else {
            throw new Error(`Missing data for timeout: broadcasterUserId=${broadcasterUserId}, userId=${logEntry.userId}`);
          }
          break;
        case 'ban':
          if (broadcasterUserId && logEntry.userId) {
              try {
                require('./websocket').registerSiteAction(logEntry.userId);
                await client.banUser(
                  broadcasterUserId,
                  logEntry.userId,
                  logEntry.reason,
                  numericOwnerId || ownerId
                );
              } catch (err) {
                if (err.message.includes('401') || err.message.includes('Unauthorized')) {
                  console.log(`[AutoMod] Ban API yetkisiz (401), sohbet komutu deneniyor... (${logEntry.username})`);
                  await client.sendMessage(logEntry.chatroomId, `/ban ${logEntry.username} ${logEntry.reason || 'AutoMod'}`);
                } else {
                  throw err;
                }
              }
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
    const content = (message.content || message.message || '').toLocaleLowerCase('tr-TR');
    const channelName = message.channel || message.chatroom_slug;
    const senderUsername = (message.sender?.username || message.username || '').toLowerCase();
    let foundViolations = [];
    
    for (const w of rule.words) {
      if (w.enabled === false) continue;
      if (w.channel && w.channel !== 'all' && w.channel !== channelName) continue;
      
      // --- targetUsername check: if set, match by sender username ---
      if (w.targetUsername && w.targetUsername.trim()) {
        const targetLower = w.targetUsername.toLowerCase().trim();
        if (senderUsername === targetLower) {
          // Username matched - check if there's also a word filter or if it's any-message
          const hasWordFilter = w.word && !w.word.startsWith('[user:');
          if (hasWordFilter) {
            // Both username AND word must match
            let targetWord = w.word.toLocaleLowerCase('tr-TR').trim();
            if (!content.includes(targetWord)) continue; // word didn't match, skip
          }
          // Match found (username matched, and word matched or no word filter)
          console.log(`[AutoMod] TARGET USER MATCH: "${senderUsername}" (word: "${w.word}") in channel=${channelName}`);
          foundViolations.push({
            ruleName: 'bannedWords',
            reason: `Hedef kullanıcı tespit edildi: @${w.targetUsername}${hasWordFilter ? ` (kelime: "${w.word}")` : ' (tüm mesajlar)'}`,
            matchedWord: w.targetUsername,
            action: w.action,
            duration: w.duration
          });
        }
        continue; // targetUsername set but didn't match this sender, skip
      }
      
      // --- Normal word matching (no targetUsername) ---
      let targetWord = w.word.toLocaleLowerCase('tr-TR').trim();
      if (!targetWord || targetWord.startsWith('[user:')) continue;

      let matched = false;
      
      if (w.exactMatch) {
        // Escape special regex characters
        const escaped = targetWord.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        
        // Simple boundary check: target word must not be surrounded by letters/numbers
        const idx = content.indexOf(targetWord);
        if (idx !== -1) {
          const before = idx > 0 ? content[idx - 1] : ' ';
          const after = idx + targetWord.length < content.length ? content[idx + targetWord.length] : ' ';
          const isWordChar = (ch) => /[a-zA-Z0-9\u00C0-\u024F\u0400-\u04FF\u00e7\u011f\u0131\u00f6\u015f\u00fc\u00c7\u011e\u0130\u00d6\u015e\u00dc]/.test(ch);
          if (!isWordChar(before) && !isWordChar(after)) {
            matched = true;
          }
        }
        // If indexOf didn't match, also try regex as backup
        if (!matched) {
          try {
            const re = new RegExp('(?:^|[^a-zA-Z0-9\\u00C0-\\u024F\\u0400-\\u04FF])(' + escaped + ')(?:$|[^a-zA-Z0-9\\u00C0-\\u024F\\u0400-\\u04FF])', 'i');
            matched = re.test(content);
          } catch(e) {
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
