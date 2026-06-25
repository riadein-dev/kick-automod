const fs = require('fs');

const content = fs.readFileSync('server/index.js', 'utf8');

const anchor = '      for (const log of pendingSpamLogs) {';
const index = content.indexOf(anchor);

if (index === -1) {
    console.error('Anchor not found!');
    process.exit(1);
}

const beforeAnchor = content.substring(0, index + anchor.length);

const restOfFile = `
        const channel = channels.find(c => 
          String(c.id) === String(log.chatroomId) || 
          String(c.chatroomId) === String(log.chatroomId) ||
          c.slug === log.channel
        );
          const broadcasterUserId = channel ? (channel.broadcasterUserId || channel.userId) : null;
          if (broadcasterUserId) {
            await kickClient.timeoutUser(broadcasterUserId, log.userId, log.duration || 5, log.reason, sessionUserId);
            store.updateModerationLog(log.id, { status: 'applied', action: 'timeout', duration: log.duration || 5 });
          }
      }
    } catch (e) {
      console.error('Failed to apply retroactive auto-timeouts:', e);
    }
  }
  
  res.json(result);
});

apiRouter.patch('/rules/:ruleName', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const { ruleName } = req.params;
  res.json(store.updateRule(sessionUserId, ruleName, req.body));
});

// Custom Words Management
apiRouter.post('/words', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const wordData = req.body;

  // Check for exact duplicates to prevent double-click bugs
  const currentRules = store.getAutomodRules(sessionUserId);
  const exists = currentRules.rules.bannedWords.words.find(w => 
    w.word.toLocaleLowerCase('tr-TR') === wordData.word.toLocaleLowerCase('tr-TR') && 
    w.exactMatch === (wordData.exactMatch || false)
  );
  
  if (exists) {
      return res.json(exists);
  }

  const word = store.addCustomWord(sessionUserId, wordData);
  res.json(word);
});

apiRouter.delete('/words/:id', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  store.removeCustomWord(sessionUserId, req.params.id);
  res.json({ success: true });
});

apiRouter.delete('/words', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  store.removeAllCustomWords(sessionUserId);
  res.json({ success: true });
});

apiRouter.patch('/words/:id', (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const { enabled } = req.body;
  const word = store.toggleCustomWord(sessionUserId, req.params.id, enabled);
  if (word) {
      res.json(word);
  } else {
      res.status(404).json({ error: 'Kelime bulunamadı' });
  }
});

// Word Preset Sharing
apiRouter.post('/words/share', async (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  const rules = store.getAutomodRules(sessionUserId);
  const words = rules.rules.bannedWords.words || [];
  
  if (words.length === 0) {
      return res.status(400).json({ error: 'Paylaşılacak kelime bulunamadı.' });
  }

  // Generate a random 5-character alphanumeric code
  const shareCode = Math.random().toString(36).substring(2, 7).toUpperCase();
  
  if (process.env.MONGODB_URI) {
      const { WordPreset } = require('./db');
      try {
          await WordPreset.create({
              shareCode,
              ownerId: sessionUserId,
              words: words.map(w => ({
                  word: w.word,
                  exactMatch: w.exactMatch,
                  action: w.action,
                  duration: w.duration
              }))
          });
      } catch (err) {
          console.error('[WordPreset] Paylaşım kodu oluşturulamadı:', err);
          return res.status(500).json({ error: 'Paylaşım kodu oluşturulamadı.' });
      }
  } else {
      return res.status(500).json({ error: 'Veritabanı bağlı değil, paylaşım özelliği kullanılamaz.' });
  }

  res.json({ success: true, shareCode });
});

apiRouter.post('/words/import', async (req, res) => {
  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  let { shareCode } = req.body;
  
  if (!shareCode) return res.status(400).json({ error: 'Paylaşım kodu gerekli.' });
  shareCode = shareCode.toUpperCase().trim();

  if (!process.env.MONGODB_URI) {
      return res.status(500).json({ error: 'Veritabanı bağlı değil.' });
  }

  const { WordPreset } = require('./db');
  try {
      const preset = await WordPreset.findOne({ shareCode });
      if (!preset) {
          return res.status(404).json({ error: 'Geçersiz veya süresi dolmuş kod.' });
      }

      const rules = store.getAutomodRules(sessionUserId);
      const currentWords = rules.rules.bannedWords.words || [];
      let importedCount = 0;

      for (const w of preset.words) {
          // Check if word already exists with the exact same settings
          const exists = currentWords.some(cw => 
              cw.word.toLocaleLowerCase('tr-TR') === w.word.toLocaleLowerCase('tr-TR') &&
              cw.action === w.action &&
              String(cw.duration) === String(w.duration) &&
              Boolean(cw.exactMatch) === Boolean(w.exactMatch)
          );
          
          if (!exists) {
              // If word text exists but settings are different, we still add it.
              // (If you prefer to overwrite instead of add duplicate texts, we can change this logic).
              store.addCustomWord(sessionUserId, {
                  word: w.word,
                  exactMatch: w.exactMatch || false,
                  action: w.action || 'ban',
                  duration: w.duration || 0,
                  channel: 'all' // Imported words apply to all channels by default
              });
              importedCount++;
          }
      }

      res.json({ success: true, importedCount });
  } catch (err) {
      console.error('[WordPreset] İçe aktarma hatası:', err);
      return res.status(500).json({ error: 'İçe aktarma sırasında bir hata oluştu.' });
  }
});

// ==== ADMIN PANEL ====
const requireAdmin = (req, res, next) => {
    // Sadece Kick API'den gelen ve doğrulanmış isim Riadein ise
    if (req.session.user && req.session.user.name && req.session.user.name.toLowerCase() === 'riadein') {
        next();
    } else {
        res.status(403).json({ error: 'Bu alana sadece geliştirici (Riadein) erişebilir.' });
    }
};

apiRouter.get('/admin/visitors', requireAdmin, (req, res) => {
    res.json(store.getVisitors());
});

`;

const tailIndex = content.indexOf("apiRouter.post('/admin/ban', requireAdmin, async (req, res) => {");
if (tailIndex === -1) {
    console.error('Tail not found!');
    process.exit(1);
}

const tail = content.substring(tailIndex);

const newContent = beforeAnchor + restOfFile + tail;
fs.writeFileSync('server/index.js', newContent, 'utf8');
console.log('Fixed index.js successfully!');
