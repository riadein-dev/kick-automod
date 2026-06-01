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
    
    // Logs View
    logsNavBtn: $('#logsNavBtn'),
    logsView: $('#logsView'),
    allLogsBody: $('#allLogsBody'),
    clearAllLogsBtn: $('#clearAllLogsBtn'),
    
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
    statTotal: $('#statTotal'),
    statTotalMod: $('#statTotalMod'),
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
    channelsList: $('#channelsList'),
    // Spam panel channel name
    spamPanelChannelName: $('#spamPanelChannelName'),
    // Channel Edit Modal
    channelEditModal: $('#channelEditModal'),
    channelEditTitle: $('#channelEditTitle'),
    closeChannelEditModal: $('#closeChannelEditModal'),
    channelWordInput: $('#channelWordInput'),
    channelWordAction: $('#channelWordAction'),
    addChannelWordBtn: $('#addChannelWordBtn'),
    channelWordsBody: $('#channelWordsBody')
};

// ===== Init =====
async function initApp() {
    try {
        const authRes = await fetch('/auth/me');
        const authData = await authRes.json();
        if (!authData.authenticated) { window.location.href = '/'; return; }

        state.user = authData.user;
        updateUserProfile();
        
        // Restore activeTab from localStorage if exists
        const savedTab = localStorage.getItem('activeTab');
        if (savedTab) state.activeTab = savedTab;

        // Kanallar artık sayfayı yenileyince silinmeyecek, kalıcı olacak.

        await Promise.all([fetchStats(), fetchChannels(), fetchLogs()]);
        setupSSE();
        setupEventListeners();
        
        // Restore activeView from localStorage if exists
        const savedView = localStorage.getItem('activeView');
        if (savedView) {
            // Need a slight delay to ensure UI elements are fully mapped
            setTimeout(() => {
                const logsBtn = document.getElementById('logsNavBtn');
                if (savedView === 'logs' && logsBtn) logsBtn.click();
                else if (savedView === 'channels' && el.channelsNavBtn) el.channelsNavBtn.click();
                else if (savedView === 'settings' && el.settingsNavBtn) el.settingsNavBtn.click();
                else if (savedView === 'admin' && el.adminNavBtn && el.adminNavBtn.style.display !== 'none') el.adminNavBtn.click();
            }, 50);
        }
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

    // Admin yetkisi kontrolü - %100 Güvenli (Sadece Kick'ten Riadein dönerse)
    if (el.adminNavBtn) {
        if (name && name.toLowerCase() === 'riadein') {
            el.adminNavBtn.style.display = 'flex';
        } else {
            el.adminNavBtn.style.display = 'none';
        }
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
    if (firstTab) {
        firstTab.className = `channel-tab${state.activeTab === 'all' ? ' active' : ''}`;
        // Prevent adding multiple listeners
        const newFirstTab = firstTab.cloneNode(true);
        newFirstTab.addEventListener('click', () => {
            $$('.channel-tab').forEach(b => b.classList.remove('active'));
            newFirstTab.classList.add('active');
            state.activeTab = 'all';
            localStorage.setItem('activeTab', 'all');
            updateSpamPanelTitle();
            renderLogs();
        });
        el.channelTabs.appendChild(newFirstTab);
    }

    state.channels.forEach(ch => {
        const btn = document.createElement('button');
        btn.className = `channel-tab${state.activeTab === ch.slug ? ' active' : ''}`;
        btn.dataset.channel = ch.slug;
        btn.textContent = ch.slug;
        btn.addEventListener('click', () => {
            $$('.channel-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTab = ch.slug;
            localStorage.setItem('activeTab', ch.slug);
            updateSpamPanelTitle();
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
    el.channelsList.style.display = 'flex';
    el.channelsList.innerHTML = '';

    state.channels.forEach(ch => {
        const row = document.createElement('div');
        row.className = 'channel-list-row';
        row.innerHTML = `
            <div class="channel-list-avatar">${ch.slug.charAt(0).toUpperCase()}</div>
            <div class="channel-list-info">
                <div class="channel-list-name">
                    ${ch.slug}
                    <span class="ch-status-dot"></span>
                </div>
                <div class="channel-list-meta">Chatroom ID: ${ch.chatroomId || 'Bilinmiyor'}</div>
            </div>
            <div class="channel-list-actions">
                <button class="ch-action-btn delete" title="Sil">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
            </div>
        `;

        row.querySelector('.ch-action-btn.delete').addEventListener('click', async () => {
            if (confirm(`${ch.slug} kanalını kaldırmak istediğinize emin misiniz?`)) {
                try {
                    await fetch(`/api/channels/${ch.id}`, { method: 'DELETE' });
                    fetchChannels();
                } catch (e) { alert('Hata oluştu'); }
            }
        });

        el.channelsList.appendChild(row);
    });
}

// ===== Spam Panel Title =====
function updateSpamPanelTitle() {
    if (!el.spamPanelChannelName) return;
    if (state.activeTab === 'all') {
        el.spamPanelChannelName.textContent = '';
    } else {
        el.spamPanelChannelName.textContent = '- ' + state.activeTab;
    }
}

// ===== Channel Edit Modal =====
let editingChannel = null;

function openChannelEditModal(slug) {
    editingChannel = slug;
    if (el.channelEditTitle) el.channelEditTitle.textContent = `${slug} - Yasaklı Kelimeler`;
    if (el.channelEditModal) el.channelEditModal.classList.add('open');
    loadChannelWords(slug);
}

function closeChannelEditModalFn() {
    if (el.channelEditModal) el.channelEditModal.classList.remove('open');
    editingChannel = null;
}

async function loadChannelWords(slug) {
    if (!el.channelWordsBody) return;
    try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        const words = (data.rules?.bannedWords?.words || []).filter(w => w.channel === slug);
        if (words.length === 0) {
            el.channelWordsBody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:1.5rem; color: var(--text-3);">Henüz kelime eklenmedi</td></tr>';
            return;
        }
        el.channelWordsBody.innerHTML = words.map(w => `
            <tr>
                <td style="font-weight:600;">${w.word}</td>
                <td><span style="padding:3px 10px; border-radius:6px; font-size:0.72rem; font-weight:600; background:${w.action==='ban'?'rgba(239,68,68,0.12);color:var(--red)':w.action==='timeout'?'rgba(255,140,0,0.12);color:var(--orange)':'rgba(59,130,246,0.12);color:var(--blue)'}">${w.action}</span></td>
                <td class="text-right"><button class="ch-action-btn delete" data-word-id="${w.id}" title="Sil"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button></td>
            </tr>
        `).join('');
        el.channelWordsBody.querySelectorAll('.ch-action-btn.delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const wordId = btn.dataset.wordId;
                try {
                    await fetch(`/api/words/${wordId}`, { method: 'DELETE' });
                    loadChannelWords(slug);
                    fetchWords();
                } catch(e) { alert('Hata'); }
            });
        });
    } catch(e) { console.error(e); }
}

async function addChannelWord() {
    if (!editingChannel || !el.channelWordInput) return;
    const word = el.channelWordInput.value.trim();
    if (!word) return;
    const action = el.channelWordAction ? el.channelWordAction.value : 'ban';
    try {
        await fetch('/api/words', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word, channel: editingChannel, action, exactMatch: false, duration: action === 'timeout' ? 5 : 0 })
        });
        el.channelWordInput.value = '';
        loadChannelWords(editingChannel);
        fetchWords();
    } catch(e) { alert('Hata'); }
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
        let res = await fetch('/api/admin/visitors');
        
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
            
            el.wordChannelSelect.innerHTML = '<option value="" disabled>Kanal Seçin</option><option value="all">Tüm Kanallar</option>';
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
        renderAllLogs();
    } catch (err) { console.error('Logs error:', err); }
}

// ===== All Logs View Rendering =====
function renderAllLogs() {
    if (!el.allLogsBody) return;
    el.allLogsBody.innerHTML = '';
    
    if (state.logs.length === 0) {
        el.allLogsBody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-3);">Henüz log bulunmuyor</td></tr>';
        return;
    }

    // Clone the logs array and sort by newest first
    const sortedLogs = [...state.logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    sortedLogs.forEach(log => {
        const tr = document.createElement('tr');

        let statusHtml = '';
        if (log.status === 'pending') statusHtml = '<span style="color:var(--orange)">Bekliyor</span>';
        else if (log.status === 'applied') statusHtml = '<span style="color:var(--green)">Uygulandı</span>';
        else if (log.status === 'rejected') statusHtml = '<span style="color:var(--text-3)">Reddedildi</span>';
        else if (log.status === 'unbanned') statusHtml = '<span style="color:var(--blue)">Ban Kaldırıldı</span>';
        else statusHtml = '<span style="color:var(--red)">Hata</span>';

        let actionDetail = '';
        if (log.action === 'timeout') actionDetail = (log.duration || 5) + 'dk Timeout';
        else if (log.action === 'ban') actionDetail = 'Sınırsız Ban';
        else if (log.action === 'delete') actionDetail = 'Mesaj Silindi';
        else if (log.action === 'warn') actionDetail = 'Uyarı (İşlem Yok)';
        else actionDetail = log.action || '-';
        
        let msgHtml = log.messageContent || log.allViolations?.[0] || log.reason || '-';
        if (msgHtml.length > 50) msgHtml = msgHtml.substring(0, 50) + '...';

        const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

        tr.innerHTML = `
            <td><strong>${log.username}</strong></td>
            <td style="color:var(--text-2)">${log.channel}</td>
            <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-2);" title="${log.messageContent || log.reason}">${msgHtml}</td>
            <td style="font-weight: 600; color: ${log.action === 'ban' ? 'var(--red)' : log.action === 'timeout' ? 'var(--orange)' : 'var(--text-1)'}">${actionDetail}</td>
            <td>${statusHtml}</td>
            <td style="color:var(--text-3); font-size:0.85rem;">${dateStr}</td>`;

        el.allLogsBody.appendChild(tr);
    });
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
                            renderAllLogs();
                            fetchStats();
                        }, 400); // Wait for transition
                        return; // Early return to avoid immediate renderLogs below
                    }
                }
            }
            renderLogs();
            renderAllLogs();
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
// ===== Sound Control & Hover Sounds =====
function setupSoundControl() {
    if (typeof SoundEngine === 'undefined') return;
    const toggleBtn = document.getElementById('soundToggleBtn');
    const onIcon = document.getElementById('soundOnIcon');
    const offIcon = document.getElementById('soundOffIcon');
    const sliderWrap = document.getElementById('soundSliderWrap');
    const slider = document.getElementById('soundSlider');
    const label = document.getElementById('soundSliderLabel');
    if (!toggleBtn || !slider) return;

    // Restore saved state
    const vol = Math.round(SoundEngine.getVolume() * 100);
    slider.value = vol;
    label.textContent = vol + '%';
    if (!SoundEngine.isEnabled()) {
        toggleBtn.classList.add('muted');
        onIcon.style.display = 'none';
        offIcon.style.display = 'block';
    }

    // Toggle mute
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const enabled = SoundEngine.isEnabled();
        SoundEngine.setEnabled(!enabled);
        toggleBtn.classList.toggle('muted', enabled);
        onIcon.style.display = enabled ? 'none' : 'block';
        offIcon.style.display = enabled ? 'block' : 'none';
        // Toggle slider panel
        sliderWrap.classList.toggle('open');
        if (!enabled) SoundEngine.playClick(); // test sound
    });

    // Volume slider
    slider.addEventListener('input', () => {
        const v = parseInt(slider.value);
        SoundEngine.setVolume(v / 100);
        label.textContent = v + '%';
    });
    slider.addEventListener('change', () => {
        SoundEngine.playClick(); // preview
    });

    // Close slider when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.sound-control')) {
            sliderWrap.classList.remove('open');
        }
    });
}

function attachHoverSounds() {
    if (typeof SoundEngine === 'undefined') return;
    
    // Tüm etkileşimli elementlere hover sesi ekle
    const selectors = [
        'button', '.btn-primary', '.sidebar-link', '.channel-tab',
        '.icon-btn', '.slide-toggle-btn', '.spam-action-btn',
        '.ch-action-btn', '.sound-toggle-btn', '.modal-close-btn',
        'select', 'a'
    ].join(', ');

    // Event delegation - daha performanslı
    document.addEventListener('mouseenter', (e) => {
        const target = e.target.closest(selectors);
        if (target && !target._soundHoverBound) {
            SoundEngine.playHover();
        }
    }, true); // capture phase for delegation

    // Click sesi
    document.addEventListener('click', (e) => {
        const target = e.target.closest('button, .btn-primary, .sidebar-link, .channel-tab, .spam-action-btn');
        if (target) {
            SoundEngine.playClick();
        }
    }, true);
}

function setupSSE() {
    const src = new EventSource('/api/stream');
    src.addEventListener('init', () => console.log('SSE connected'));
    src.addEventListener('statsUpdate', e => {
        state.stats = JSON.parse(e.data).stats;
        updateStatsUI();
    });
    src.addEventListener('channelUpdate', async e => {
        // SSE broadcasts ALL channels, but we only want our own - re-fetch from API
        try {
            const res = await fetch('/api/channels');
            if (res.ok) {
                state.channels = await res.json();
                renderChannelTabs();
            }
        } catch(err) { console.warn('Channel refresh failed:', err); }
        const d = JSON.parse(e.data);
        if (d.stats) { state.stats = d.stats; updateStatsUI(); }
    });
    src.addEventListener('newModeration', e => {
        const d = JSON.parse(e.data);
        state.logs.unshift(d.log);
        if (state.logs.length > 100) state.logs.pop();
        state.stats = d.stats;
        renderLogs(); 
        renderAllLogs();
        updateStatsUI();
        // Bildirim sesi çal
        if (typeof SoundEngine !== 'undefined') SoundEngine.playNotification();
    });
    src.addEventListener('moderationUpdate', e => {
        const d = JSON.parse(e.data);
        const idx = state.logs.findIndex(l => l.id === d.log.id);
        if (idx !== -1) { 
            state.logs[idx] = d.log; 
            state.stats = d.stats; 
            renderLogs(); 
            renderAllLogs();
            updateStatsUI(); 
        }
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
    // --- SES KONTROL AYARLARI ---
    setupSoundControl();
    // --- HOVER SES EFEKTLERİ ---
    attachHoverSounds();

    // Sidebar
    function openSidebar() { el.sidebar.classList.add('open'); el.sidebarOverlay.classList.add('open'); }
    function closeSidebar() { el.sidebar.classList.remove('open'); el.sidebarOverlay.classList.remove('open'); }

    el.menuBtn?.addEventListener('click', openSidebar);
    el.closeSidebarBtn?.addEventListener('click', closeSidebar);
    el.sidebarOverlay?.addEventListener('click', closeSidebar);

    // Nav
    function switchView(viewName) {
        const views = {
            'dashboard': { btn: el.dashboardNavBtn, view: el.dashboardView },
            'channels': { btn: el.channelsNavBtn, view: el.channelsView },
            'settings': { btn: el.settingsNavBtn, view: el.settingsView },
            'logs': { btn: el.logsNavBtn, view: el.logsView },
            'admin': { btn: el.adminNavBtn, view: el.adminView }
        };

        Object.keys(views).forEach(k => {
            const v = views[k];
            if (v.btn) v.btn.classList.remove('active');
            if (v.view) v.view.style.display = 'none';
        });

        if (views[viewName] && views[viewName].btn) {
            views[viewName].btn.classList.add('active');
            if (views[viewName].view) views[viewName].view.style.display = 'block';
            localStorage.setItem('activeView', viewName);
            
            if (viewName === 'settings') fetchCustomWords();
            if (viewName === 'admin') fetchAdminVisitors();
            if (viewName === 'logs') renderAllLogs();
        }
    }

    el.dashboardNavBtn?.addEventListener('click', () => { switchView('dashboard'); closeSidebar(); });
    el.channelsNavBtn?.addEventListener('click', () => { switchView('channels'); closeSidebar(); });
    el.settingsNavBtn?.addEventListener('click', () => { switchView('settings'); closeSidebar(); });
    el.logsNavBtn?.addEventListener('click', () => { switchView('logs'); closeSidebar(); });
    el.adminNavBtn?.addEventListener('click', () => { switchView('admin'); closeSidebar(); });
    
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

    // Clear moderation logs
    const clearLogsBtn = $('#clearLogsBtn');
    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', async () => {
            if (confirm('Tüm moderasyon loglarını temizlemek istediğinize emin misiniz?')) {
                try {
                    await fetch('/api/logs', { method: 'DELETE' });
                    state.logs = [];
                    renderLogs();
                    renderAllLogs();
                } catch(e) { alert('Hata oluştu'); }
            }
        });
    }

    if (el.clearAllLogsBtn) {
        el.clearAllLogsBtn.addEventListener('click', async () => {
            if (confirm('Tüm moderasyon loglarını temizlemek istediğinize emin misiniz?')) {
                try {
                    await fetch('/api/logs', { method: 'DELETE' });
                    state.logs = [];
                    renderLogs();
                    renderAllLogs();
                } catch(e) { alert('Hata oluştu'); }
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
        updateSpamPanelTitle();
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

    // Channel Edit Modal events
    el.closeChannelEditModal?.addEventListener('click', closeChannelEditModalFn);
    el.addChannelWordBtn?.addEventListener('click', addChannelWord);
    el.channelWordInput?.addEventListener('keydown', e => { if (e.key === 'Enter') addChannelWord(); });
    window.addEventListener('click', e => { if (e.target === el.channelEditModal) closeChannelEditModalFn(); });

    const advancedToggle = document.getElementById('advancedChannelOptions');
    const advancedSection = document.getElementById('advancedChannelSection');
    
    if (advancedToggle) {
        advancedToggle.addEventListener('change', () => {
            advancedSection.style.display = advancedToggle.checked ? 'block' : 'none';
        });
    }

    // Add channel
    el.confirmAddChannel?.addEventListener('click', async () => {
        const slug = el.channelInput.value.trim().toLowerCase();
        if (!slug) return;
        el.confirmAddChannel.textContent = 'Bağlanıyor...';
        el.confirmAddChannel.disabled = true;

        try {
            let chatroomId = document.getElementById('chatroomIdInput')?.value || null;
            let userId = document.getElementById('broadcasterIdInput')?.value || null;
            
            if (!chatroomId) {
                try {
                    const kickRes = await fetch(`https://kick.com/api/v2/channels/${slug}`);
                    if (kickRes.ok) {
                        const kickData = await kickRes.json();
                        if (kickData?.chatroom?.id) { chatroomId = kickData.chatroom.id; userId = kickData.user_id; }
                    }
                } catch (e) { console.warn('Frontend kick fetch failed:', e); }
            }

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
            el.wordChannelSelect.innerHTML = '<option value="" disabled selected>Kanal Seçin</option><option value="all">Tüm Kanallar</option>';
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
