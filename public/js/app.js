/**
 * Kick AutoMod - Frontend Application Logic
 */

// ===== State =====
const state = {
    user: null,
    channels: [],
    stats: { totalModeration: 0, pending: 0, applied: 0, activeChannels: 0, messagesReceived: 0 },
    logs: [],
    activeTab: 'all'
};

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const el = {
    // Header
    menuBtn: $('#menuBtn'),
    userName: $('#userName'),
    userAvatar: $('#userAvatar'),
    logoutBtn: $('#logoutBtn'),
    // Sidebar
    sidebar: $('#sidebar'),
    sidebarOverlay: $('#sidebarOverlay'),
    closeSidebarBtn: $('#closeSidebarBtn'),
    sidebarAvatar: $('#sidebarAvatar'),
    sidebarUserName: $('#sidebarUserName'),
    dashboardNavBtn: $('#dashboardNavBtn'),
    channelsNavBtn: $('#channelsNavBtn'),
    // Settings
    settingsNavBtn: $('#settingsNavBtn'),
    settingsView: $('#settingsView'),
    
    // Admin Panel
    adminNavBtn: $('#adminNavBtn'),
    adminView: $('#adminView'),
    visitorsListBody: $('#visitorsListBody'),
    clearVisitorsBtn: $('#clearVisitorsBtn'),

    addWordBtn: $('#addWordBtn'),
    addWordModal: $('#addWordModal'),
    closeWordModalBtn: $('#closeWordModalBtn'),
    wordChannelSelect: $('#wordChannelSelect'),
    wordInput: $('#wordInput'),
    wordExactMatch: $('#wordExactMatch'),
    wordActionSelect: $('#wordActionSelect'),
    wordDurationGroup: $('#wordDurationGroup'),
    wordDurationInput: $('#wordDurationInput'),
    confirmAddWord: $('#confirmAddWord'),
    wordsListBody: $('#wordsListBody'),
    wordCountLabel: $('#wordCountLabel'),
    // Status
    wsStatusDot: $('#wsStatusDot'),
    wsStatusText: $('#wsStatusText'),
    activeChannelsText: $('#activeChannelsText'),
    messagesReceivedText: $('#messagesReceivedText'),
    // Stats
    statTotal: $('#statTotal'),
    statPending: $('#statPending'),
    statApplied: $('#statApplied'),
    statActiveChannels: $('#statActiveChannels'),
    // Channels
    channelTabs: $('#channelTabs'),
    addChannelBtn: $('#addChannelBtn'),
    // Views
    dashboardView: $('#dashboardView'),
    channelsView: $('#channelsView'),
    // Queue
    modQueueBody: $('#modQueueBody'),
    emptyQueueRow: $('#emptyQueueRow'),
    spamQueueBody: $('#spamQueueBody'),
    emptySpamRow: $('#emptySpamRow'),
    // Modal
    addChannelModal: $('#addChannelModal'),
    channelInput: $('#channelInput'),
    confirmAddChannel: $('#confirmAddChannel'),
    closeModalBtn: $('#closeModalBtn'),
    // Toggles
    emoteToggle: $('#emoteToggle'),
    modeToggle: $('#modeToggle'),
    // Spam Panel Toggle
    toggleSpamBtn: $('#toggleSpamBtn'),
    spamPanelWrapper: $('#spamPanelWrapper'),
    // Channels View
    channelsEmpty: $('#channelsEmpty'),
    channelsList: $('#channelsList')
};

// ===== Init =====
async function initApp() {
    try {
        const authRes = await fetch('/auth/me');
        const authData = await authRes.json();
        if (!authData.authenticated) { window.location.href = '/'; return; }

        state.user = authData.user;
        updateUserProfile();

        await Promise.all([fetchStats(), fetchChannels(), fetchLogs()]);
        setupSSE();
        setupEventListeners();
    } catch (err) {
        console.error('Init error:', err);
    }
}

// ===== Profile & Channels =====
function updateUserProfile() {
    if (!state.user) return;
    
    let name = state.user.username || state.user.name || state.user.slug || state.user.preferred_username;
    
    // Eğer isim bulunamadıysa arka plandan gelene kadar geçici isim ver
    if (!name || name === 'Kullanıcı' || name === 'Kick User') {
        // Önceden kaydedilmiş varsa onu kullan (sessizce)
        const cached = localStorage.getItem('customKickUsername');
        if (cached) {
            name = cached;
        } else {
            // ID varsa onu göster, yoksa Yönetici yaz
            name = state.user.id ? `User_${String(state.user.id).substring(0,4)}` : 'Yönetici';
        }
    }
    
    if (name.toLowerCase() === 'riadein') name = 'Riadein'; // Görsellik için baş harfi büyüt

    const initial = name.charAt(0).toUpperCase();

    if (el.userName) el.userName.textContent = name;
    if (el.userAvatar) el.userAvatar.textContent = initial;
    if (el.sidebarUserName) el.sidebarUserName.textContent = name;
    if (el.sidebarAvatar) el.sidebarAvatar.textContent = initial;
    
    // Admin yetkisi kontrolü
    if (name && name.toLowerCase() === 'riadein' && el.adminNavBtn) {
        el.adminNavBtn.style.display = 'flex';
    } else if (el.adminNavBtn) {
        el.adminNavBtn.style.display = 'none';
    }
}

// ===== Stats =====
function updateStatsUI() {
    el.statTotal.textContent = state.stats.totalModeration;
    el.statPending.textContent = state.stats.pending;
    el.statApplied.textContent = state.stats.applied;
    el.statActiveChannels.textContent = state.stats.activeChannels;
    el.activeChannelsText.textContent = `${state.stats.activeChannels} kanal`;
    el.messagesReceivedText.textContent = `${state.stats.messagesReceived} mesaj`;
}

// ===== Channel Tabs =====
function renderChannelTabs() {
    // Keep "All Channels" tab
    const firstTab = el.channelTabs.querySelector('.channel-tab[data-channel="all"]');
    el.channelTabs.innerHTML = '';
    if (firstTab) el.channelTabs.appendChild(firstTab);

    state.channels.forEach(ch => {
        const btn = document.createElement('button');
        btn.className = `channel-tab${state.activeTab === ch.slug ? ' active' : ''}`;
        btn.dataset.channel = ch.slug;
        btn.textContent = ch.slug;
        btn.addEventListener('click', () => {
            $$('.channel-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTab = ch.slug;
            renderLogs();
        });
        el.channelTabs.appendChild(btn);
    });

    renderChannelsList();
}

function renderChannelsList() {
    if (!el.channelsList || !el.channelsEmpty) return;

    if (state.channels.length === 0) {
        el.channelsEmpty.style.display = 'block';
        el.channelsList.style.display = 'none';
        return;
    }

    el.channelsEmpty.style.display = 'none';
    el.channelsList.style.display = 'grid';
    el.channelsList.innerHTML = '';

    state.channels.forEach(ch => {
        const card = document.createElement('div');
        card.className = 'panel';
        card.style.position = 'relative';
        card.style.display = 'flex';
        card.style.alignItems = 'center';
        card.style.gap = '1rem';
        
        card.innerHTML = `
            <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--border-color); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; font-weight: bold; color: var(--text-2);">
                ${ch.slug.charAt(0).toUpperCase()}
            </div>
            <div style="flex: 1;">
                <h3 style="margin-bottom: 0.2rem; display: flex; align-items: center; gap: 0.5rem;">
                    ${ch.slug}
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green);"></span>
                </h3>
                <div style="color: var(--text-3); font-size: 0.8rem;">Chatroom ID: ${ch.chatroomId || 'Bilinmiyor'}</div>
            </div>
            <button class="btn-primary remove-ch-btn" style="background: rgba(239, 68, 68, 0.1); color: var(--red); border: none; padding: 0.5rem;" title="Kaldır">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        `;

        card.querySelector('.remove-ch-btn').addEventListener('click', async () => {
            if (confirm(`${ch.slug} kanalını kaldırmak istediğinize emin misiniz?`)) {
                try {
                    await fetch(`/api/channels/${ch.id}`, { method: 'DELETE' });
                    fetchChannels();
                } catch (e) { alert('Hata oluştu'); }
            }
        });

        el.channelsList.appendChild(card);
    });
}

// ===== Moderation Logs =====
function renderLogs() {
    const filtered = state.activeTab === 'all'
        ? state.logs
        : state.logs.filter(l => l.channel === state.activeTab);

    // Spam panel shows only pending spam detections
    const spamLogs = filtered.filter(l => l.ruleName === 'spamDetection' && l.status === 'pending' && !l.hiddenUI);
    
    // Mod Queue shows everything else (including applied/rejected spam detections, and all other rules)
    const otherLogs = filtered.filter(l => l.ruleName !== 'spamDetection' || l.status !== 'pending' || l.hiddenUI);

    // --- Render Spam Panel ---
    if (spamLogs.length === 0) {
        el.spamQueueBody.innerHTML = '';
        el.spamQueueBody.appendChild(el.emptySpamRow);
        el.emptySpamRow.style.display = 'flex';
        if(document.getElementById('spamCountBadge')) {
            document.getElementById('spamCountBadge').textContent = '0';
        }
    } else {
        el.spamQueueBody.innerHTML = '';
        if(document.getElementById('spamCountBadge')) {
            document.getElementById('spamCountBadge').textContent = spamLogs.length;
        }
        
        spamLogs.forEach(log => {
            const card = document.createElement('div');
            card.className = 'spam-card';
            card.setAttribute('data-log-id', log.id);
            
            // In Spam panel, reason contains the message content logic usually, or we can use log.messageContent if available
            const msgContent = log.messageContent || log.allViolations?.[0] || log.reason;

            // Spam panelinde butonlar her zaman görünsün, işlem yapılmış olsa bile ezebilmek için.
            let actionsHtml = `
                <div class="spam-actions">
                    <button class="spam-action-btn" onclick="handleTimeoutAction('${log.id}', 300)">5dk</button>
                    <button class="spam-action-btn" onclick="handleTimeoutAction('${log.id}', 600)">10dk</button>
                    <button class="spam-action-btn" onclick="handleTimeoutAction('${log.id}', 900)">15dk</button>
                    <button class="spam-action-btn" onclick="handleAction('${log.id}', 'applied', 'ban')">Ban</button>
                    <button class="spam-action-btn" onclick="handleAction('${log.id}', 'rejected', null)">Yok say</button>
                </div>
            `;
            
            if (log.status !== 'pending') {
                actionsHtml += `<div style="color:var(--text-3); font-size:0.75rem; text-align: center; margin-top: 8px;">Mevcut Durum: ${log.status === 'applied' ? 'Uygulandı' : log.status} (${log.action || ''})</div>`;
            }

            // We duplicate the message 3 times to simulate the UI from the screenshot
            const repeatsHtml = `
                <div class="spam-msg-box">${msgContent}</div>
                <div class="spam-msg-box">${msgContent}</div>
                <div class="spam-msg-box">${msgContent}</div>
            `;

            card.innerHTML = `
                <div class="spam-card-header">
                    <span class="spam-username">${log.username}</span>
                    <span class="spam-badge">3. aynı mesaj</span>
                </div>
                <div class="spam-main-msg">${msgContent}</div>
                <div class="spam-repeats">
                    ${repeatsHtml}
                </div>
                ${actionsHtml}
            `;

            el.spamQueueBody.appendChild(card);
        });
    }

    // --- Render Mod Queue ---
    if (otherLogs.length === 0) {
        el.modQueueBody.innerHTML = '';
        el.modQueueBody.appendChild(el.emptyQueueRow);
        el.emptyQueueRow.style.display = 'table-row';
        return;
    }

    el.modQueueBody.innerHTML = '';
    otherLogs.forEach(log => {
        const tr = document.createElement('tr');

        let statusHtml = '';
        if (log.status === 'pending') statusHtml = '<span style="color:var(--orange)">Bekliyor</span>';
        else if (log.status === 'applied') statusHtml = '<span style="color:var(--green)">Uygulandı</span>';
        else if (log.status === 'rejected') statusHtml = '<span style="color:var(--text-3)">Reddedildi</span>';
        else if (log.status === 'unbanned') statusHtml = '<span style="color:var(--blue)">Ban Kaldırıldı</span>';
        else statusHtml = '<span style="color:var(--red)">Hata</span>';

        let isBanOrTimeout = false;
        let isApplied = log.status === 'applied';
        
        let actionsHtml = '';
        if (log.status === 'pending') {
            actionsHtml = `
                <div class="spam-actions" style="margin-top:0; justify-content: flex-end;">
                    <button class="spam-action-btn" style="padding: 4px 8px; font-size: 0.7rem;" onclick="handleTimeoutAction('${log.id}', 300)">5dk</button>
                    <button class="spam-action-btn" style="padding: 4px 8px; font-size: 0.7rem;" onclick="handleTimeoutAction('${log.id}', 600)">10dk</button>
                    <button class="spam-action-btn" style="padding: 4px 8px; font-size: 0.7rem;" onclick="handleAction('${log.id}', 'applied', 'ban')">Ban</button>
                    <button class="spam-action-btn" style="padding: 4px 8px; font-size: 0.7rem;" onclick="handleAction('${log.id}', 'rejected', null)">Yok say</button>
                </div>`;
        } else if (isApplied && (log.action === 'timeout' || log.action === 'ban')) {
            actionsHtml = `
                <div class="action-btns">
                    <button class="action-btn reject" style="min-width: 60px;" onclick="handleAction('${log.id}','unbanned','unban')" title="Unban at">Unban</button>
                </div>`;
        } else {
            actionsHtml = `<span style="color:var(--text-3);font-size:0.72rem">${log.action || ''}</span>`;
        }

        let actionDetail = '';
        if (log.action === 'timeout') actionDetail = (log.duration || 5) + 'dk Timeout';
        else if (log.action === 'ban') actionDetail = 'Sınırsız Ban';
        else if (log.action === 'delete') actionDetail = 'Mesaj Silindi';
        else actionDetail = log.action || '-';
        
        let msgHtml = log.messageContent || log.allViolations?.[0] || log.reason || '-';
        // Truncate long messages
        if (msgHtml.length > 50) msgHtml = msgHtml.substring(0, 50) + '...';

        tr.innerHTML = `
            <td><strong>${log.username}</strong></td>
            <td style="color:var(--text-2)">${log.channel}</td>
            <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-2);" title="${log.messageContent || log.reason}">${msgHtml}</td>
            <td style="font-weight: 600; color: ${log.action === 'ban' ? 'var(--red)' : log.action === 'timeout' ? 'var(--orange)' : 'var(--text-1)'}">${actionDetail}</td>
            <td>${statusHtml}</td>
            <td class="text-right">${actionsHtml}</td>`;

        el.modQueueBody.appendChild(tr);
    });
}

// ===== API =====
async function fetchStats() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        state.stats = data.stats;
        state.automodRules = data.automodRules; // Update state with rules
        updateStatsUI();
        const chip = el.wsStatusDot?.closest('.status-chip');
        if (data.wsStatus?.connected) {
            chip?.classList.add('connected');
            el.wsStatusText.textContent = 'WebSocket Bağlı';
        } else {
            chip?.classList.remove('connected');
            el.wsStatusText.textContent = 'Bağlantı Koptu';
        }
        
        // Sync Spam Mode Toggle UI with server state
        const spamModeToggle = document.getElementById('spamModeToggle');
        if (spamModeToggle && state.automodRules) {
            const mode = state.automodRules.mode || 'auto';
            if (mode === 'manual') {
                spamModeToggle.classList.add('right');
            } else {
                spamModeToggle.classList.remove('right');
            }
            const btns = spamModeToggle.querySelectorAll('.slide-toggle-btn');
            btns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
        }

        // Sync Emote Spam Toggle
        const emoteSpamToggle = document.getElementById('emoteSpamToggle');
        if (emoteSpamToggle && state.automodRules && state.automodRules.rules && state.automodRules.rules.emoteSpam) {
            const isEmoteEnabled = state.automodRules.rules.emoteSpam.enabled;
            if (!isEmoteEnabled) {
                emoteSpamToggle.classList.add('right');
            } else {
                emoteSpamToggle.classList.remove('right');
            }
            const btns = emoteSpamToggle.querySelectorAll('.slide-toggle-btn');
            btns.forEach(b => {
                b.classList.toggle('active', (b.dataset.mode === 'on' && isEmoteEnabled) || (b.dataset.mode === 'off' && !isEmoteEnabled));
            });
        }
    } catch (err) { console.error('Stats error:', err); }
}

async function fetchChannels() {
    try {
        const res = await fetch('/api/channels');
        state.channels = await res.json();
        renderChannelTabs();
    } catch (err) { console.error('Channels error:', err); }
}

async function fetchCustomWords() {
    // The words are fetched within fetchStats -> data.automodRules
    if (state.automodRules && state.automodRules.rules.bannedWords.words) {
        renderWords();
    }
}

// ==== Admin Panel ====
async function fetchAdminVisitors() {
    if (!el.visitorsListBody) return;
    try {
        const res = await fetch('/api/admin/visitors');
        if (!res.ok) {
            el.visitorsListBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--red);">Yetkisiz erişim. Sadece yönetici (Riadein) görebilir.</td></tr>`;
            return;
        }
        const visitors = await res.json();
        
        if (visitors.length === 0) {
            el.visitorsListBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-3);">Henüz ziyaretçi kaydı yok.</td></tr>`;
            return;
        }
        
        el.visitorsListBody.innerHTML = '';
        visitors.forEach(v => {
            const tr = document.createElement('tr');
            
            // Format dates
            const firstDate = new Date(v.lastLogin).toLocaleString('tr-TR');
            const createdAtDate = v.kickCreatedAt ? new Date(v.kickCreatedAt).toLocaleDateString('tr-TR') : 'Bilinmiyor';
            
            // Info string
            let extInfo = '';
            if (v.email) extInfo += `<div>✉️ ${v.email}</div>`;
            if (v.followers !== undefined) extInfo += `<div style="color:var(--orange)">👥 ${v.followers} Takipçi</div>`;
            if (v.bio) extInfo += `<div style="font-size: 0.7rem; color:var(--text-3); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${v.bio}">📝 ${v.bio}</div>`;
            
            const uaString = v.userAgent ? v.userAgent.substring(0, 40) + '...' : '-';
            
            tr.innerHTML = `
                <td>
                    <div style="display:flex; align-items:center; gap: 8px;">
                        ${v.profilePic ? `<img src="${v.profilePic}" style="width:24px; height:24px; border-radius:50%;">` : '<div style="width:24px; height:24px; border-radius:50%; background:var(--border);"></div>'}
                        <strong>${v.username}</strong>
                    </div>
                </td>
                <td style="color:var(--text-2); font-family:monospace;">${v.kickId || '-'}</td>
                <td style="color:var(--green); font-family:monospace;">${v.ip}</td>
                <td>${extInfo || '-'}</td>
                <td style="color:var(--text-2); font-size: 0.8rem;">
                    <div>${firstDate}</div>
                    <div style="font-size:0.7rem; color:var(--text-3);">Kayıt: ${createdAtDate}</div>
                </td>
                <td><span style="padding: 2px 8px; border-radius: 12px; background:var(--bg-elevated); border:1px solid var(--border); font-size:0.8rem;">${v.loginCount} kez</span></td>
                <td style="color:var(--text-3); font-size: 0.75rem;" title="${v.userAgent}">${uaString}</td>
            `;
            el.visitorsListBody.appendChild(tr);
        });
    } catch (e) {
        console.error('Visitors fetch failed:', e);
    }
}
// ====================

function renderWords() {
    if (!el.wordsListBody || !state.automodRules) return;
    const words = state.automodRules.rules.bannedWords.words || [];
    el.wordCountLabel.textContent = `Yasak kelimeler ve moderasyon kuralları (${words.length} kelime)`;
    el.wordsListBody.innerHTML = '';
    
    if (words.length === 0) {
        el.wordsListBody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:var(--text-3); padding: 2rem;">Henüz kelime eklenmedi</td></tr>`;
        return;
    }

    words.forEach(w => {
        const tr = document.createElement('tr');
        
        let actionBadge = '';
        if (w.action === 'ban') actionBadge = '<span style="color:var(--red); font-weight:700; font-size:0.75rem; background:rgba(239,68,68,0.1); padding:4px 8px; border-radius:4px;">BAN</span>';
        else if (w.action === 'timeout') actionBadge = '<span style="color:var(--orange); font-weight:700; font-size:0.75rem; background:rgba(245,158,11,0.1); padding:4px 8px; border-radius:4px;">TIMEOUT</span>';
        else if (w.action === 'warn') actionBadge = '<span style="color:var(--blue); font-weight:700; font-size:0.75rem; background:rgba(59,130,246,0.1); padding:4px 8px; border-radius:4px;">UYARI</span>';

        const durationStr = w.action === 'timeout' ? `${w.duration}dk` : (w.action === 'ban' ? 'Sınırsız' : '-');
        const wordHtml = w.exactMatch ? `${w.word} <span style="background:var(--green); color:#000; padding: 2px 6px; border-radius:4px; font-size:0.65rem; white-space:nowrap;">Tam Cümle</span>` : w.word;

        tr.innerHTML = `
            <td><div style="color:#fff; font-family:monospace; background:#222; padding:6px 10px; border-radius:4px; display:inline-flex; align-items:center; gap:8px;">${wordHtml}</div></td>
            <td style="color:var(--text-2);">${w.channel || 'Tüm Kanallar'}</td>
            <td>${actionBadge}</td>
            <td style="color:var(--text-2);">${durationStr}</td>
            <td class="text-right">
                <button class="action-btn approve edit-word-btn" data-id="${w.id}" title="Düzenle">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                </button>
                <button class="action-btn reject delete-word-btn" data-id="${w.id}" title="Sil">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </td>
        `;
        el.wordsListBody.appendChild(tr);
    });

    document.querySelectorAll('.delete-word-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.dataset.id;
            if(confirm('Kelimeyi silmek istediğinize emin misiniz?')) {
                try {
                    await fetch(`/api/words/${id}`, { method: 'DELETE' });
                    await fetchStats(); // re-fetches rules
                    fetchCustomWords(); // re-renders words list
                } catch(err) { alert('Silinemedi'); }
            }
        });
    });

    document.querySelectorAll('.edit-word-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const w = state.automodRules.rules.bannedWords.words.find(x => x.id === id);
            if (!w) return;
            
            el.wordChannelSelect.innerHTML = '<option value="" disabled>Kanal Seçin</option>';
            state.channels.forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch.slug;
                opt.textContent = ch.slug;
                el.wordChannelSelect.appendChild(opt);
            });
            el.wordChannelSelect.value = w.channel || '';
            el.wordInput.value = w.word;
            el.wordExactMatch.checked = w.exactMatch;
            el.wordActionSelect.value = w.action;
            if (w.action === 'timeout') {
                el.wordDurationGroup.style.display = 'block';
                el.wordDurationInput.value = w.duration;
            } else {
                el.wordDurationGroup.style.display = 'none';
            }
            
            el.confirmAddWord.dataset.editId = w.id;
            el.addWordModal.classList.add('open');
        });
    });
}

async function fetchLogs() {
    try {
        const res = await fetch('/api/moderation');
        state.logs = await res.json();
        renderLogs();
    } catch (err) { console.error('Logs error:', err); }
}

async function handleAction(logId, status, actionType, duration = null) {
    try {
        const body = { status, action: actionType };
        if (duration) body.duration = duration;

        const res = await fetch(`/api/moderation/${logId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (res.ok) {
            const log = state.logs.find(l => l.id === logId);
            if (log) {
                log.status = status;
                log.action = actionType;
                
                // If it's a spam panel action, apply dissolve animation before re-rendering
                if (log.ruleName === 'spamDetection') {
                    const card = document.querySelector(`.spam-card[data-log-id="${logId}"]`);
                    if (card) {
                        card.classList.add('dissolve');
                        log.hiddenUI = true;
                        
                        setTimeout(() => {
                            renderLogs();
                            fetchStats();
                        }, 400); // Wait for transition
                        return; // Early return to avoid immediate renderLogs below
                    }
                }
            }
            renderLogs();
            fetchStats();
        }
    } catch (err) { console.error('Action error:', err); alert('İşlem başarısız.'); }
}

async function handleTimeoutAction(logId, durationInSeconds) {
    await handleAction(logId, 'applied', 'timeout', durationInSeconds / 60); // API uses minutes currently
}

window.handleAction = handleAction;
window.handleTimeoutAction = handleTimeoutAction;

// ===== SSE =====
function setupSSE() {
    const src = new EventSource('/api/stream');
    src.addEventListener('init', () => console.log('SSE connected'));
    src.addEventListener('statsUpdate', e => {
        state.stats = JSON.parse(e.data).stats;
        updateStatsUI();
    });
    src.addEventListener('channelUpdate', e => {
        const d = JSON.parse(e.data);
        state.channels = d.channels; state.stats = d.stats;
        renderChannelTabs(); updateStatsUI();
    });
    src.addEventListener('newModeration', e => {
        const d = JSON.parse(e.data);
        state.logs.unshift(d.log);
        if (state.logs.length > 100) state.logs.pop();
        state.stats = d.stats;
        renderLogs(); updateStatsUI();
    });
    src.addEventListener('moderationUpdate', e => {
        const d = JSON.parse(e.data);
        const idx = state.logs.findIndex(l => l.id === d.log.id);
        if (idx !== -1) { state.logs[idx] = d.log; state.stats = d.stats; renderLogs(); updateStatsUI(); }
    });
    src.addEventListener('wsStatus', e => {
        const d = JSON.parse(e.data);
        const chip = el.wsStatusDot?.closest('.status-chip');
        if (d.connected) {
            chip?.classList.add('connected');
            el.wsStatusText.textContent = 'WebSocket Bağlı';
        } else {
            chip?.classList.remove('connected');
            el.wsStatusText.textContent = 'Bağlantı Koptu';
        }
    });
}

// ===== Events =====
function setupEventListeners() {
    // Sidebar
    function openSidebar() { el.sidebar.classList.add('open'); el.sidebarOverlay.classList.add('open'); }
    function closeSidebar() { el.sidebar.classList.remove('open'); el.sidebarOverlay.classList.remove('open'); }

    el.menuBtn?.addEventListener('click', openSidebar);
    el.closeSidebarBtn?.addEventListener('click', closeSidebar);
    el.sidebarOverlay?.addEventListener('click', closeSidebar);

    // Nav
    el.dashboardNavBtn?.addEventListener('click', () => {
        el.dashboardNavBtn.classList.add('active');
        el.channelsNavBtn.classList.remove('active');
        if (el.settingsNavBtn) el.settingsNavBtn.classList.remove('active');
        if (el.adminNavBtn) el.adminNavBtn.classList.remove('active');
        el.dashboardView.style.display = 'block';
        el.channelsView.style.display = 'none';
        if (el.settingsView) el.settingsView.style.display = 'none';
        if (el.adminView) el.adminView.style.display = 'none';
        closeSidebar();
    });
    el.channelsNavBtn?.addEventListener('click', () => {
        el.channelsNavBtn.classList.add('active');
        el.dashboardNavBtn.classList.remove('active');
        if (el.settingsNavBtn) el.settingsNavBtn.classList.remove('active');
        if (el.adminNavBtn) el.adminNavBtn.classList.remove('active');
        el.channelsView.style.display = 'block';
        el.dashboardView.style.display = 'none';
        if (el.settingsView) el.settingsView.style.display = 'none';
        if (el.adminView) el.adminView.style.display = 'none';
        closeSidebar();
    });
    if (el.settingsNavBtn && el.settingsView) {
        el.settingsNavBtn.addEventListener('click', () => {
            el.settingsNavBtn.classList.add('active');
            el.dashboardNavBtn.classList.remove('active');
            el.channelsNavBtn.classList.remove('active');
            if (el.adminNavBtn) el.adminNavBtn.classList.remove('active');
            el.settingsView.style.display = 'block';
            el.dashboardView.style.display = 'none';
            el.channelsView.style.display = 'none';
            if (el.adminView) el.adminView.style.display = 'none';
            fetchCustomWords();
            closeSidebar();
        });
    }
    if (el.adminNavBtn && el.adminView) {
        el.adminNavBtn.addEventListener('click', () => {
            el.adminNavBtn.classList.add('active');
            el.dashboardNavBtn.classList.remove('active');
            el.channelsNavBtn.classList.remove('active');
            if (el.settingsNavBtn) el.settingsNavBtn.classList.remove('active');
            el.adminView.style.display = 'block';
            el.dashboardView.style.display = 'none';
            el.channelsView.style.display = 'none';
            if (el.settingsView) el.settingsView.style.display = 'none';
            fetchAdminVisitors();
            closeSidebar();
        });
    }
    
    if (el.clearVisitorsBtn) {
        el.clearVisitorsBtn.addEventListener('click', async () => {
            if (confirm('Tüm ziyaretçi kayıtlarını silmek istediğinize emin misiniz?')) {
                try {
                    await fetch('/api/admin/visitors', { method: 'DELETE' });
                    fetchAdminVisitors();
                } catch(e) {}
            }
        });
    }

    // Logout
    el.logoutBtn?.addEventListener('click', async () => {
        await fetch('/auth/logout', { method: 'POST' });
        window.location.href = '/';
    });

    // Channel tabs - first tab
    el.channelTabs?.querySelector('.channel-tab[data-channel="all"]')?.addEventListener('click', () => {
        $$('.channel-tab').forEach(b => b.classList.remove('active'));
        el.channelTabs.querySelector('.channel-tab[data-channel="all"]').classList.add('active');
        state.activeTab = 'all';
        renderLogs();
    });

    // Modal
    const popularStreamers = ['Eray', 'Elraenn', 'Jahrein', 'KendineMuzisyen', 'Wtcn', 'Unlost', 'AdinRoss', 'xQc'];
    el.addChannelBtn?.addEventListener('click', () => {
        el.channelInput.placeholder = `Örn: ${popularStreamers[Math.floor(Math.random() * popularStreamers.length)]}`;
        el.addChannelModal.classList.add('open');
        setTimeout(() => el.channelInput.focus(), 150);
    });
    el.closeModalBtn?.addEventListener('click', () => el.addChannelModal.classList.remove('open'));
    window.addEventListener('click', e => { if (e.target === el.addChannelModal) el.addChannelModal.classList.remove('open'); });

    // Add channel
    el.confirmAddChannel?.addEventListener('click', async () => {
        const slug = el.channelInput.value.trim();
        if (!slug) return;

        el.confirmAddChannel.textContent = 'Kanal Bulunuyor...';
        el.confirmAddChannel.disabled = true;

        try {
            let chatroomId = null, userId = null;
            try {
                const kickRes = await fetch(`https://kick.com/api/v2/channels/${slug}`);
                if (kickRes.ok) {
                    const kickData = await kickRes.json();
                    if (kickData?.chatroom?.id) { chatroomId = kickData.chatroom.id; userId = kickData.user_id; }
                }
            } catch (e) { console.warn('Frontend kick fetch failed:', e); }

            el.confirmAddChannel.textContent = 'Bağlanıyor...';

            const res = await fetch('/api/channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ slug, chatroomId, userId })
            });
            const data = await res.json();
            if (res.ok) {
                el.channelInput.value = '';
                el.addChannelModal.classList.remove('open');
            } else {
                alert('Hata: ' + (data.error || 'Kanal eklenemedi'));
            }
        } catch (err) { alert('Bağlantı hatası'); }
        finally {
            el.confirmAddChannel.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Kanala Bağlan`;
            el.confirmAddChannel.disabled = false;
        }
    });

    // Toggle Spam Panel
    el.toggleSpamBtn.addEventListener('click', () => {
        el.spamPanelWrapper.classList.toggle('open');
        const isOpen = el.spamPanelWrapper.classList.contains('open');
        el.toggleSpamBtn.style.background = isOpen ? 'var(--bg-elevated)' : 'var(--orange)';
        el.toggleSpamBtn.style.color = isOpen ? 'var(--text-1)' : '#000';
    });
    
    // Spam Mode Toggle Button API Link
    const spamModeToggle = document.getElementById('spamModeToggle');
    if (spamModeToggle) {
        const btns = spamModeToggle.querySelectorAll('.slide-toggle-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.classList.contains('active')) return;
                const mode = btn.dataset.mode;
                
                // Visual slide effect immediately
                if (mode === 'manual') {
                    spamModeToggle.classList.add('right');
                } else {
                    spamModeToggle.classList.remove('right');
                }
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Update server
                try {
                    await fetch('/api/rules', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode })
                    });
                    if (state.automodRules) {
                        state.automodRules.mode = mode;
                    }
                } catch (e) { console.error('Failed to update rule mode:', e); }
            });
        });
    }
    // Emote Spam Toggle Button API Link
    const emoteSpamToggle = document.getElementById('emoteSpamToggle');
    if (emoteSpamToggle) {
        const btns = emoteSpamToggle.querySelectorAll('.slide-toggle-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', async () => {
                if (btn.classList.contains('active')) return;
                const isEmoteEnabled = btn.dataset.mode === 'on';
                
                // Visual slide effect immediately
                if (!isEmoteEnabled) {
                    emoteSpamToggle.classList.add('right');
                } else {
                    emoteSpamToggle.classList.remove('right');
                }
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Update server
                try {
                    await fetch('/api/rules/emoteSpam', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ enabled: isEmoteEnabled })
                    });
                    if (state.automodRules && state.automodRules.rules && state.automodRules.rules.emoteSpam) {
                        state.automodRules.rules.emoteSpam.enabled = isEmoteEnabled;
                    }
                } catch (e) { console.error('Failed to update rule emoteSpam:', e); }
            });
        });
    }

    // Add Word Modal logic
    if (el.addWordBtn && el.addWordModal) {
        el.addWordBtn.addEventListener('click', () => {
            el.wordChannelSelect.innerHTML = '<option value="" disabled selected>Kanal Seçin</option>';
            state.channels.forEach(ch => {
                const opt = document.createElement('option');
                opt.value = ch.slug;
                opt.textContent = ch.slug;
                el.wordChannelSelect.appendChild(opt);
            });
            el.wordInput.value = '';
            el.wordExactMatch.checked = false;
            el.wordActionSelect.value = 'ban';
            el.wordDurationGroup.style.display = 'none';
            delete el.confirmAddWord.dataset.editId; // clear edit id
            el.addWordModal.classList.add('open');
        });

        el.closeWordModalBtn.addEventListener('click', () => el.addWordModal.classList.remove('open'));
        
        el.wordActionSelect.addEventListener('change', (e) => {
            if (e.target.value === 'timeout') {
                el.wordDurationGroup.style.display = 'block';
            } else {
                el.wordDurationGroup.style.display = 'none';
            }
        });

        el.confirmAddWord.addEventListener('click', async () => {
            const channel = el.wordChannelSelect.value;
            const word = el.wordInput.value.trim();
            const action = el.wordActionSelect.value;
            const exactMatch = el.wordExactMatch.checked;
            const duration = el.wordDurationInput.value;

            if (!channel || !word) {
                alert('Lütfen kanal seçin ve bir kelime girin.');
                return;
            }

            try {
                el.confirmAddWord.disabled = true;
                el.confirmAddWord.textContent = 'Kaydediliyor...';
                
                const editId = el.confirmAddWord.dataset.editId;
                if (editId) {
                    await fetch(`/api/words/${editId}`, { method: 'DELETE' });
                }

                const payload = { channel, word, action, exactMatch, duration: parseInt(duration, 10) };
                const res = await fetch('/api/words', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                if (res.ok) {
                    el.addWordModal.classList.remove('open');
                    await fetchStats(); // Update state.automodRules
                    fetchCustomWords(); // re-render immediately
                } else {
                    alert('Kelime eklenirken hata oluştu');
                }
            } catch (err) {
                alert('Bağlantı hatası');
            } finally {
                el.confirmAddWord.disabled = false;
                el.confirmAddWord.textContent = 'Kaydet';
            }
        });
    }
}

// ===== Boot =====
document.addEventListener('DOMContentLoaded', initApp);
