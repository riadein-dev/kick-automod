/**
 * Kick AutoMod Dashboard - OAuth 2.1 Handler (PKCE)
 * Handles Kick OAuth authentication flow
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const KICK_AUTH_URL = 'https://id.kick.com/oauth/authorize';
const KICK_TOKEN_URL = 'https://id.kick.com/oauth/token';
const KICK_API_URL = 'https://api.kick.com/public/v1';

// Generate PKCE code verifier and challenge
function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// Generate random state
function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * GET /auth/login
 * Initiates OAuth flow - redirects user to Kick authorization page
 */
router.get('/login', (req, res) => {
  const { verifier, challenge } = generatePKCE();
  const state = generateState();

  // Store PKCE verifier and state in session
  req.session.pkceVerifier = verifier;
  req.session.oauthState = state;

  const params = new URLSearchParams({
    client_id: process.env.KICK_CLIENT_ID,
    redirect_uri: process.env.KICK_REDIRECT_URI,
    response_type: 'code',
    scope: 'user:read chat:write chat:read events:subscribe channel:read moderation:ban moderation:ban:manage',
    state: state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  req.session.save(() => {
    res.redirect(`${KICK_AUTH_URL}?${params.toString()}`);
  });
});

/**
 * GET /auth/callback
 * OAuth callback - exchanges authorization code for access token
 */
router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    console.error('OAuth error:', error);
    return res.redirect('/?error=' + encodeURIComponent(error));
  }

  // Verify state
  if (state !== req.session.oauthState) {
    console.error('State mismatch');
    return res.redirect('/?error=state_mismatch');
  }

  const verifier = req.session.pkceVerifier;
  if (!verifier) {
    console.error('No PKCE verifier in session');
    return res.redirect('/?error=no_verifier');
  }

  try {
    // Exchange code for token
    const tokenResponse = await fetch(KICK_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
        redirect_uri: process.env.KICK_REDIRECT_URI,
        code: code,
        code_verifier: verifier
      }).toString()
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorData);
      return res.redirect('/?error=token_exchange_failed');
    }

    const tokenData = await tokenResponse.json();

    // Store tokens in session
    req.session.accessToken = tokenData.access_token;
    req.session.refreshToken = tokenData.refresh_token;
    req.session.tokenExpiry = Date.now() + (tokenData.expires_in * 1000);
    req.session.tokenType = tokenData.token_type;

    // Fetch user info
    let foundName = 'Kullanıcı';
    
    // 1. OIDC id_token içinden adı çözmeyi dene (Eğer varsa)
    if (tokenData.id_token) {
        try {
            const payload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64').toString('utf8'));
            foundName = payload.preferred_username || payload.name || payload.nickname || foundName;
        } catch(e) {}
    }
    
    // 2. JWT Access Token içinden çözmeyi dene
    if (foundName === 'Kullanıcı') {
        try {
            const payload = JSON.parse(Buffer.from(tokenData.access_token.split('.')[1], 'base64').toString('utf8'));
            foundName = payload.preferred_username || payload.name || payload.username || foundName;
            req.session.userId = payload.sub; // ID'yi sakla
        } catch(e) {}
    }

    // 3. Kick Userinfo Endpoint'lerini dene
    try {
        const endpoints = [
            'https://id.kick.com/api/v1/user',
            `${KICK_API_URL}/users/me`
        ];
        
        let apiData = null;
        for (const ep of endpoints) {
            const resp = await fetch(ep, { headers: { 'Authorization': `Bearer ${tokenData.access_token}` } }).catch(() => null);
            if (resp && resp.ok) {
                apiData = await resp.json();
                break;
            }
        }

        if (apiData) {
            let raw = apiData.data || apiData;
            if (Array.isArray(raw) && raw.length > 0) {
                raw = raw[0];
            }
            foundName = raw.username || raw.name || raw.slug || raw.preferred_username || foundName;
            
            // Eğer hala bulunamadıysa ve iç içe profil objesi varsa:
            if (raw.profile && raw.profile.username) {
                foundName = raw.profile.username;
            } else if (raw.user && raw.user.username) {
                foundName = raw.user.username;
            }
        } 
        
        req.session.user = { name: foundName, raw: apiData || {} };
        
        // --- ADMIN PANEL ZİYARETÇİ TAKİBİ ---
        try {
            const store = require('./store');
            const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'] || 'Bilinmiyor';
            
            let rawDataObj = apiData && apiData.data ? apiData.data : apiData;
            if (Array.isArray(rawDataObj) && rawDataObj.length > 0) rawDataObj = rawDataObj[0];
            
            store.addVisitor({
                kickId: req.session.userId || (rawDataObj && rawDataObj.id) || null,
                username: foundName,
                ip: clientIp,
                userAgent: userAgent,
                rawData: apiData || tokenData,
                email: (rawDataObj && rawDataObj.email) || null,
                profilePic: (rawDataObj && rawDataObj.profile_pic) || null,
                bio: (rawDataObj && rawDataObj.bio) || null,
                kickCreatedAt: (rawDataObj && rawDataObj.created_at) || null,
                followers: (rawDataObj && rawDataObj.followers_count) || 0
            });
        } catch(e) { console.error('Visitor kaydı başarısız:', e); }

    } catch (userErr) {
      console.warn('Could not fetch user info API:', userErr.message);
      req.session.user = { name: foundName };
    }

    // Clean up PKCE data
    delete req.session.pkceVerifier;
    delete req.session.oauthState;

    req.session.save((saveErr) => {
      res.redirect('/dashboard.html');
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/?error=server_error');
  }
});

/**
 * GET /auth/me
 * Returns current authenticated user info
 */
router.get('/me', (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    user: req.session.user || { name: 'Kick User' },
    authenticated: true,
    tokenExpiry: req.session.tokenExpiry
  });
});

/**
 * GET /auth/token
 * Returns current access token (for API calls from frontend)
 */
router.get('/token', (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({
    accessToken: req.session.accessToken,
    tokenType: req.session.tokenType,
    expiresAt: req.session.tokenExpiry
  });
});

/**
 * POST /auth/refresh
 * Refreshes the access token using refresh token
 */
router.post('/refresh', async (req, res) => {
  if (!req.session.refreshToken) {
    return res.status(401).json({ error: 'No refresh token' });
  }

  try {
    const response = await fetch(KICK_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET,
        refresh_token: req.session.refreshToken
      }).toString()
    });

    if (!response.ok) {
      return res.status(401).json({ error: 'Refresh failed' });
    }

    const data = await response.json();
    req.session.accessToken = data.access_token;
    req.session.refreshToken = data.refresh_token || req.session.refreshToken;
    req.session.tokenExpiry = Date.now() + (data.expires_in * 1000);

    res.json({ success: true, expiresAt: req.session.tokenExpiry });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /auth/logout
 * Clears session and logs out user
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// Middleware to check authentication
function requireAuth(req, res, next) {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  
  // Check token expiry
  if (req.session.tokenExpiry && Date.now() > req.session.tokenExpiry) {
    return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
  }
  
  next();
}

module.exports = { router, requireAuth };
