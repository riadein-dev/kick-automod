const fs = require('fs');
const code = fs.readFileSync('server/index.js', 'utf8');
const lines = code.split('\n');
const startIndex = lines.findIndex(l => l.includes("apiRouter.post('/admin/unban', requireAdmin"));
if (startIndex !== -1) {
    const fixedEnd = `apiRouter.post('/admin/unban', requireAdmin, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Kullanıcı kimliği belirtilmedi.' });
    
    const visitor = await store.unbanVisitor(userId);
    if (!visitor) return res.status(404).json({ error: 'Kullanıcı bulunamadı.' });
    
    res.json({ success: true, message: 'Kullanıcının yasağı kaldırıldı.' });
});

apiRouter.delete('/admin/visitors', requireAdmin, async (req, res) => {
    store.visitors = [];
    if (process.env.MONGODB_URI) {
        const { Visitor } = require('./db');
        await Visitor.deleteMany({});
    }
    res.json({ success: true });
});
// =====================

// Server-Sent Events (SSE) stream for real-time updates to frontend
apiRouter.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Send initial data
  res.write(\`event: init\\ndata: \${JSON.stringify({ connected: true })}\\n\\n\`);

  const sessionUserId = req.session.userId || req.session.user?.name || req.sessionID;
  store.addSSEClient(res, sessionUserId);

  req.on('close', () => {
    store.removeSSEClient(res);
  });
});

app.use('/api', apiRouter);

// Start server
app.listen(PORT, () => {
  console.log(\`Kick AutoMod server running on http://localhost:\${PORT}\`);
  console.log(\`Make sure to set KICK_CLIENT_ID and KICK_CLIENT_SECRET in .env\`);
});

app.use((req, res) => {
    res.status(404).send('Böyle bir sayfa veya API bulunamadı.');
});

// Global Error Handler (Sistemin çökmesini engeller)
app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        // CSRF Token Hatası
        console.warn('Geçersiz CSRF Token Yakalandı:', req.ip);
        return res.status(403).json({ error: 'Geçersiz güvenlik sertifikası (CSRF). Lütfen sayfayı yenileyin.' });
    }
    console.error('Unhandled Server Error:', err.stack || err);
    try {
        require('fs').writeFileSync(require('path').join(__dirname, '../lasterror.txt'), err.stack || err.toString());
    } catch(e) {}
    res.status(500).json({ error: 'Sunucuda beklenmeyen bir hata oluştu ancak sistem güvenle çalışmaya devam ediyor.' });
});

} // end startServer

startServer().catch(console.error);`;
    const newCode = lines.slice(0, startIndex).join('\n') + fixedEnd;
    fs.writeFileSync('server/index.js', newCode);
    console.log("Fixed!");
}
