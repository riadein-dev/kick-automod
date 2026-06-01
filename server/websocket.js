/**
 * Kick AutoMod Dashboard - WebSocket Manager
 * Connects to Kick chat via Pusher WebSocket for real-time monitoring
 */

const PusherObj = require('pusher-js');
const Pusher = PusherObj.Pusher || PusherObj;
const store = require('./store');
const automod = require('./automod');

class WebSocketManager {
  constructor() {
    this.pusher = null;
    this.subscribedChannels = new Map(); // channelId -> pusherChannel
    this.connected = false;
  }

  /**
   * Initialize Pusher connection
   */
  connect() {
    if (this.pusher) {
      this.disconnect();
    }

    try {
      this.pusher = new Pusher('32cbd69e4b950bf97679', {
        cluster: 'us2',
        wsHost: 'ws-us2.pusher.com',
        forceTLS: true,
        enabledTransports: ['ws', 'wss']
      });

      this.pusher.connection.bind('connected', () => {
        this.connected = true;
        console.log('[WebSocket] Connected to Kick Pusher');
        store.broadcast('wsStatus', { connected: true });
        
        // Re-subscribe to all channels from DB
        const channels = store.getChannels();
        const uniqueChannels = [];
        channels.forEach(c => {
            if (!uniqueChannels.find(u => u.chatroomId === c.chatroomId)) {
                uniqueChannels.push(c);
            }
        });
        
        uniqueChannels.forEach(c => {
            const chatroomId = String(c.id || c.chatroomId);
            this.subscribeToChannel(chatroomId, c.slug, c.broadcasterUserId, c.addedBy);
        });
      });

      this.pusher.connection.bind('disconnected', () => {
        this.connected = false;
        console.log('[WebSocket] Disconnected from Kick Pusher');
        store.broadcast('wsStatus', { connected: false });
      });

      this.pusher.connection.bind('error', (err) => {
        console.error('[WebSocket] Connection error:', err);
        store.broadcast('wsStatus', { connected: false, error: err.message });
      });

    } catch (err) {
      console.error('[WebSocket] Failed to initialize Pusher:', err);
    }
  }

  /**
   * Subscribe to a channel's chatroom
   */
  subscribeToChannel(chatroomId, channelSlug, broadcasterUserId, addedBy) {
    if (!this.pusher) {
      console.warn('[WebSocket] Not connected, cannot subscribe');
      return false;
    }

    const channelName = `chatrooms.${chatroomId}.v2`;
    
    if (this.subscribedChannels.has(chatroomId)) {
      console.log(`[WebSocket] Already subscribed to ${channelSlug}, adding to store for user ${addedBy}`);
      // Add to store for this user even if already subscribed globally
      store.addChannel({
        id: chatroomId,
        slug: channelSlug,
        userId: broadcasterUserId,
        broadcasterUserId: broadcasterUserId,
        addedBy: addedBy || null
      });
      return true;
    }

    try {
      const channel = this.pusher.subscribe(channelName);

      // Chat message event
      channel.bind('App\\Events\\ChatMessageEvent', (data) => {
        this.handleChatMessage(data, channelSlug, chatroomId);
      });

      // User banned event
      channel.bind('App\\Events\\UserBannedEvent', (data) => {
        this.handleUserBanned(data, channelSlug);
      });

      // Message deleted event
      channel.bind('App\\Events\\MessageDeletedEvent', (data) => {
        this.handleMessageDeleted(data, channelSlug);
      });

      // Subscription succeeded
      channel.bind('pusher:subscription_succeeded', () => {
        console.log(`[WebSocket] Subscribed to ${channelSlug} (chatroom: ${chatroomId})`);
        store.broadcast('channelSubscribed', { channelSlug, chatroomId });
      });

      // Subscription error
      channel.bind('pusher:subscription_error', (err) => {
        console.error(`[WebSocket] Subscription error for ${channelSlug}:`, err);
      });

      this.subscribedChannels.set(chatroomId, { channel, channelSlug });
      
      // Add to store
      store.addChannel({
        id: chatroomId,
        slug: channelSlug,
        userId: broadcasterUserId,
        broadcasterUserId: broadcasterUserId,
        addedBy: addedBy || null
      });

      return true;
    } catch (err) {
      console.error(`[WebSocket] Failed to subscribe to ${channelSlug}:`, err);
      return false;
    }
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribeFromChannel(chatroomId) {
    const strId = String(chatroomId);
    
    // Find the actual key in the map (could be number or string)
    let actualKey = null;
    for (const [key] of this.subscribedChannels) {
      if (String(key) === strId) {
        actualKey = key;
        break;
      }
    }
    
    if (this.pusher && actualKey !== null) {
      const channelName = `chatrooms.${actualKey}.v2`;
      this.pusher.unsubscribe(channelName);
      const info = this.subscribedChannels.get(actualKey);
      this.subscribedChannels.delete(actualKey);
      store.removeChannel(strId);
      console.log(`[WebSocket] Unsubscribed from chatroom ${actualKey} (${info?.channelSlug || 'unknown'})`);
    } else {
      // Fallback: try direct
      const channelName = `chatrooms.${chatroomId}.v2`;
      if (this.pusher) this.pusher.unsubscribe(channelName);
      this.subscribedChannels.delete(chatroomId);
      store.removeChannel(strId);
      console.log(`[WebSocket] Force unsubscribed from chatroom ${chatroomId}`);
    }
  }

  /**
   * Handle incoming chat message
   */
  async handleChatMessage(data, channelSlug, chatroomId) {
    store.incrementMessages();

    const message = {
      id: data.id,
      message_id: data.id,
      content: data.content,
      message: data.content,
      chatroom_id: chatroomId,
      chatroom_slug: channelSlug,
      channel: channelSlug,
      sender: data.sender || {},
      user_id: data.sender?.id,
      username: data.sender?.username,
      timestamp: data.created_at || new Date().toISOString()
    };

    // Broadcast to frontend
    store.broadcast('chatMessage', {
      channel: channelSlug,
      message: {
        id: message.id,
        content: message.content,
        username: message.username,
        timestamp: message.timestamp
      }
    });

    // Run through automod
    try {
      await automod.processMessage(message);
    } catch (err) {
      console.error('[AutoMod] Error processing message:', err);
    }
  }

  /**
   * Handle user banned event
   */
  handleUserBanned(data, channelSlug) {
    console.log(`[WebSocket] User banned in ${channelSlug}:`, data);
    store.broadcast('userBanned', { channel: channelSlug, data });
  }

  /**
   * Handle message deleted event
   */
  handleMessageDeleted(data, channelSlug) {
    console.log(`[WebSocket] Message deleted in ${channelSlug}:`, data);
    store.broadcast('messageDeleted', { channel: channelSlug, data });
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      connected: this.connected,
      subscribedChannels: Array.from(this.subscribedChannels.entries()).map(([id, info]) => ({
        id,
        slug: info.channelSlug
      }))
    };
  }

  /**
   * Disconnect from Pusher
   */
  disconnect() {
    if (this.pusher) {
      this.pusher.disconnect();
      this.subscribedChannels.clear();
      this.connected = false;
    }
  }
}

// Singleton
const wsManager = new WebSocketManager();
module.exports = wsManager;
