/**
 * Kick AutoMod Dashboard - Kick API Client
 * Handles all Kick REST API interactions
 */

const KICK_API_BASE = 'https://api.kick.com/public/v1';

class KickApiClient {
  constructor(accessToken) {
    this.accessToken = accessToken;
  }

  async request(endpoint, options = {}) {
    const url = `${KICK_API_BASE}${endpoint}`;
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || 5;
        throw new Error(`Rate limited. Retry after ${retryAfter}s`);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Kick API error ${response.status}: ${errorText}`);
      }

      const text = await response.text();
      let data = null;
      if (text) {
          try {
              data = JSON.parse(text);
          } catch(e) {
              console.log('[KickAPI] Response is not JSON:', text);
          }
      }
      
      // Kick bazen 200 dondurup icinde hata mesaji veriyor
      if (data) {
          console.log(`[KickAPI] Raw Response [${endpoint}]:`, JSON.stringify(data));
          const fs = require('fs');
          fs.appendFileSync('kick_api_debug.txt', new Date().toISOString() + ' [' + endpoint + '] ' + JSON.stringify(data) + '\n');
          
          if (data.status && data.status.error) {
              throw new Error(`Kick API Hata: ${data.status.message || 'Bilinmeyen Hata'}`);
          }
          if (data.error) {
              throw new Error(`Kick API Hata: ${data.error.message || data.error}`);
          }
          if (data.message && typeof data.message === 'string') {
              const msg = data.message.toLowerCase();
              if (msg.includes('factor authentication') || msg.includes('unauthorized') || msg.includes('permission') || msg.includes('moderator') || msg.includes('invalid') || msg.includes('failed')) {
                  throw new Error(`Kick API Hatası: ${data.message}`);
              }
          }
      }
      
      return data;
    } catch (err) {
      console.error(`Kick API request failed [${endpoint}]:`, err.message);
      throw err;
    }
  }

  // ============ Channel Endpoints ============

  /**
   * Get channel info by slug
   */
  async getChannel(slug) {
    // 1. Try official public API if we have token
    if (this.accessToken) {
        try {
            const data = await this.request(`/channels/${slug}`);
            if (data && data.data && data.data[0]) {
                const channelInfo = data.data[0];
                return {
                    user_id: channelInfo.user_id,
                    chatroom: { id: channelInfo.chatroom_id }
                };
            }
        } catch (e) {
            console.warn(`[Kick API] Official API fetch failed for ${slug}, falling back to scraping...`);
        }
    }

    try {
      // 2. Fallback: Scraping v2 API (often blocked by Cloudflare)
      const resp = await fetch(`https://kick.com/api/v2/channels/${slug}`, {
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      const text = await resp.text();
      
      try {
        const data = JSON.parse(text);
        if (data && data.chatroom && data.chatroom.id) {
            return data;
        }
      } catch(e) {
        // Parse edilemezse yola devam et
      }
      
      let extractedUserId = null;
      const userMatch = text.match(/"user_id"\s*:\s*(\d+)/i);
      if (userMatch && userMatch[1]) {
        extractedUserId = parseInt(userMatch[1], 10);
      }
      
      // 3. CTRL+F / Regex taktiği: "chatroom":{"id":12345} veya benzeri yapıyı bul
      const chatroomMatch = text.match(/"chatroom"\s*:\s*\{[^}]*"id"\s*:\s*(\d+)/i);
      if (chatroomMatch && chatroomMatch[1]) {
        return {
           user_id: extractedUserId,
           chatroom: { id: parseInt(chatroomMatch[1], 10) }
        };
      }
      
      // Belki farklı bir formatta gelmiştir (sadece "chatroom_id": 1234)
      const simpleMatch = text.match(/"chatroom_id"\s*:\s*(\d+)/i);
      if (simpleMatch && simpleMatch[1]) {
        return {
           user_id: extractedUserId,
           chatroom: { id: parseInt(simpleMatch[1], 10) }
        };
      }
      
      throw new Error("Chatroom ID metin içinde bulunamadı.");
    } catch(err) {
      throw new Error(`Kanal bulunamadı veya API erişimi kısıtlı: ${slug}. Hata: ${err.message}`);
    }
  }

  /**
   * Get current user's channel info
   */
  async getMyChannel() {
    return this.request('/channels/me');
  }

  // ============ Chat Endpoints ============

  /**
   * Send a chat message
   */
  async sendMessage(chatroomId, content, broadcasterUserId = null) {
    const body = {
      content: content,
      type: 'user' // 'message' was invalid, Kick API accepts 'user' or 'bot'
    };
    
    // API expects broadcaster_user_id as an integer
    if (broadcasterUserId) {
      body.broadcaster_user_id = parseInt(broadcasterUserId);
    } else {
      body.chatroom_id = parseInt(chatroomId); // Fallback for older endpoints
    }
    
    return this.request('/chat', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  /**
   * Get recent chat messages from a channel (Kick v2 API)
   */
  async getRecentMessages(channelSlug) {
    try {
      const resp = await fetch(`https://kick.com/api/v2/channels/${channelSlug}/messages`, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (!resp.ok) {
        console.warn(`[KickAPI] Failed to fetch messages for ${channelSlug}: ${resp.status}`);
        return [];
      }
      const data = await resp.json();
      // data.data.messages is the typical structure
      const messages = data?.data?.messages || data?.messages || data?.data || [];
      if (!Array.isArray(messages)) return [];
      return messages.slice(-50);
    } catch (err) {
      console.warn(`[KickAPI] getRecentMessages error for ${channelSlug}:`, err.message);
      return [];
    }
  }

  /**
   * Delete a chat message
   */
  async deleteMessage(messageId) {
    if (!messageId) throw new Error("Message ID is required to delete a message.");
    return this.request(`/chat/${messageId}`, {
      method: 'DELETE'
    });
  }

  // ============ Moderation Endpoints ============

  /**
   * Ban a user (permanent)
   */
  async banUser(broadcasterUserId, userId, reason = '', moderatorUserId = null) {
    // API seviyesinde strict dedup (10 saniye)
    if (!this.actionCooldowns) this.actionCooldowns = new Map();
    const cdKey = `ban:${broadcasterUserId}:${userId}`;
    const last = this.actionCooldowns.get(cdKey);
    if (last && (Date.now() - last) < 10000) {
        console.log(`[KickAPI] STRICT BLOCK: Duplicate ban prevented for user ${userId}`);
        return { status: 'cooldown_blocked' };
    }
    this.actionCooldowns.set(cdKey, Date.now());
    const payload = {
      broadcaster_user_id: parseInt(broadcasterUserId),
      user_id: parseInt(userId),
      reason: reason
    };
    // DİKKAT: moderator_user_id Kick API'de bug yapıyor, o yüzden token sahibini kendi anlıyor
    console.log('[KickAPI] Sending Ban payload:', payload);
    return this.request('/moderation/bans', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  /**
   * Unban or remove timeout from a user
   */
  async unbanUser(broadcasterUserId, userId, moderatorUserId = null) {
    const payload = {
      broadcaster_user_id: parseInt(broadcasterUserId),
      user_id: parseInt(userId)
    };
    // DİKKAT: moderator_user_id Kick API'de bug yapıyor, o yüzden token sahibini kendi anlıyor
    console.log('[KickAPI] Sending Unban payload:', payload);
    return this.request('/moderation/bans', {
      method: 'DELETE',
      body: JSON.stringify(payload)
    });
  }

  /**
   * Timeout a user (temporary)
   */
  async timeoutUser(broadcasterUserId, userId, duration = 5, reason = '', moderatorUserId = null) {
    // API seviyesinde strict dedup (10 saniye)
    if (!this.actionCooldowns) this.actionCooldowns = new Map();
    const cdKey = `timeout:${broadcasterUserId}:${userId}`;
    const last = this.actionCooldowns.get(cdKey);
    if (last && (Date.now() - last) < 10000) {
        console.log(`[KickAPI] STRICT BLOCK: Duplicate timeout prevented for user ${userId}`);
        return { status: 'cooldown_blocked' };
    }
    this.actionCooldowns.set(cdKey, Date.now());
    const payload = {
      broadcaster_user_id: parseInt(broadcasterUserId),
      user_id: parseInt(userId),
      duration: parseInt(duration), // minutes
      reason: reason
    };
    // DİKKAT: moderator_user_id gönderilmiyor çünkü Kick API bearer token sahibini zaten moderatör olarak alıyor.
    // Eğer gönderirsek Kick API kendi içinde aynı işlemi 2 kere execute edip chate 2 kere yansıtabiliyor!
    console.log('[KickAPI] Sending Timeout payload:', payload);
    return this.request('/moderation/bans', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }



  /**
   * Get user info
   */
  async getUser() {
    return this.request('/users/me');
  }

  // ============ Events / Webhooks ============

  /**
   * Subscribe to events
   */
  async subscribeToEvents(events) {
    return this.request('/events/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        events: events
      })
    });
  }

  /**
   * Get active subscriptions
   */
  async getSubscriptions() {
    return this.request('/events/subscriptions');
  }
}

// Factory function
function createKickClient(accessToken) {
  return new KickApiClient(accessToken);
}

module.exports = { KickApiClient, createKickClient };
