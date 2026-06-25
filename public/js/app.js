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

// ===== API Fetch Wrapper (CSRF Koruması) =====
let csrfToken = null;
async function apiFetch(url, options = {}) {
    // Sadece Kick API hariç bizim kendi API'lerimizde CSRF uygula
    if (!url.startsWith('http') && (options.method && options.method !== 'GET')) {
        if (!csrfToken) {
            try {
                const res = await fetch('/api/csrf-token');
                const data = await res.json();
                csrfToken = data.csrfToken;
            } catch (e) { console.error('CSRF token alınamadı:', e); }
        }
        options.headers = {
            ...options.headers,
            'CSRF-Token': csrfToken
        };
        // Content-Type otomatik JSON değilse, ama body string ise JSON yapalım
        if (options.body && typeof options.body === 'string' && !options.headers['Content-Type']) {
            options.headers['Content-Type'] = 'application/json';
        }
    }
    const response = await fetch(url, options);
    // CSRF hatası alırsak tokeni sıfırla
    if (response.status === 403) {
        const errorData = await response.clone().json().catch(() => ({}));
        if (errorData.error && errorData.error.includes('CSRF')) {
            csrfToken = null;
        }
    }
    return response;
}

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const el = {
    // Header
    menuBtn: $('#menuBtn'),
    systemToggleBtn: $('#systemToggleBtn'),
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
    crossBanNavBtn: $('#crossBanNavBtn'),
    crossBanView: $('#crossBanView'),

    shareWordsBtn: $('#shareWordsBtn'),
    importWordsBtn: $('#importWordsBtn'),
    deleteAllWordsBtn: $('#deleteAllWordsBtn'),
    addWordBtn: $('#addWordBtn'),
    addWordModal: $('#addWordModal'),
    shareWordsModal: $('#shareWordsModal'),
    importWordsModal: $('#importWordsModal'),
    closeWordModalBtn: $('#closeWordModalBtn'),
    closeShareModalBtn: $('#closeShareModalBtn'),
    closeImportModalBtn: $('#closeImportModalBtn'),
    copyShareCodeBtn: $('#copyShareCodeBtn'),
    shareCodeDisplay: $('#shareCodeDisplay'),
    confirmImportWords: $('#confirmImportWords'),
    wordChannelSelect: $('#wordChannelSelect'),
    wordInput: $('#wordInput'),
    wordExactMatch: $('#wordExactMatch'),
    wordActionSelect: $('#wordActionSelect'),
    wordDurationGroup: $('#wordDurationGroup'),
    wordDurationInput: $('#wordDurationInput'),
    confirmAddWord: $('#confirmAddWord'),
    spamMaxRepeatsInput: $('#spamMaxRepeatsInput'),
    spamMaxRepeatsVal: $('#spamMaxRepeatsVal'),
    saveSpamSettingsBtn: $('#saveSpamSettingsBtn'),
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
    chatControlView: $('#chatControlView'),
    
    // Chat Control specific
    chatControlNavBtn: $('#chatControlNavBtn'),
    chatControlTabs: $('#chatControlTabs'),
    toggleSpamPanelBtn: $('#toggleSpamPanelBtn'),
    chatRightSpamPanel: $('#chatRightSpamPanel'),
    chatRightCol: $('#chatRightCol'),
    chatSettingsBtn: $('#chatSettingsBtn'),
    chatContainer: $('#chatContainer'),
    chatControlMessages: $('#chatContainer'),
    chatMessageInput: $('#chatMessageInput'),
    chatSendBtn: $('#chatSendBtn'),
    chatSettingsModal: $('#chatSettingsModal'),
    closeChatSettingsModal: $('#closeChatSettingsModal'),
    cancelChatSettingsBtn: $('#cancelChatSettingsBtn'),
    saveChatSettingsBtn: $('#saveChatSettingsBtn'),
    chatDefaultTimeout: $('#chatDefaultTimeout'),
    chatKeyDelete: $('#chatKeyDelete'),
    chatKeyTimeout: $('#chatKeyTimeout'),
    chatKeyBan: $('#chatKeyBan'),
    chatWatchedWords: $('#chatWatchedWords'),
    chatSpamQueueBody: $('#chatSpamQueueBody'),
    chatEmptySpamRow: $('#chatEmptySpamRow'),
    chatModQueueBody: $('#chatModQueueBody'),
    chatEmptyModRow: $('#chatEmptyModRow'),
    
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
        const authRes = await apiFetch('/auth/me');
        const authData = await authRes.json();
        if (!authData.authenticated) { window.location.href = '/'; return; }

        state.user = authData.user;
        updateUserProfile();
        
        // Restore activeTab from localStorage if exists
        const savedTab = localStorage.getItem('activeTab');
        if (savedTab) state.activeTab = savedTab;

        // Kanallar artık sayfayı yenileyince silinmeyecek, kalıcı olacak.

        await Promise.all([fetchStats(), fetchChannels(), fetchLogs()]);
        
        // Auto-start system if it was left disabled (prevents accidental permanent stops)
        if (state.automodRules && state.automodRules.enabled === false) {
            console.log('Sistem kapalı kalmış, otomatik başlatılıyor...');
            apiFetch('/api/rules', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: true })
            }).then(() => {
                state.automodRules.enabled = true;
                updateSystemToggleUI();
            }).catch(e => console.error('Oto-başlatma hatası:', e));
        }

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
        
        checkOnboarding();
        setupChatControlLogic();
    } catch (err) {
        console.error('Init error:', err);
    }
}

// ===== Onboarding Logic =====

window.showConfirm = function(title, text, confirmBtnText = 'Onayla', confirmBtnStyle = '') {
    return new Promise((resolve) => {
        const modal = $('#confirmModal');
        if (!modal) return resolve(window.confirm(text)); // Fallback

        $('#confirmModalTitle').textContent = title;
        $('#confirmModalText').textContent = text;
        
        const acceptBtn = $('#acceptConfirmBtn');
        const defaultStyle = 'background: var(--red); color: #fff; border-color: var(--red); width: 120px; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4);';
        
        acceptBtn.textContent = confirmBtnText;
        acceptBtn.style.cssText = confirmBtnStyle || defaultStyle;

        const handleAccept = () => { cleanup(); resolve(true); };
        const handleCancel = () => { cleanup(); resolve(false); };

        const cleanup = () => {
            modal.classList.remove('open');
            acceptBtn.removeEventListener('click', handleAccept);
            $('#cancelConfirmBtn').removeEventListener('click', handleCancel);
            $('#closeConfirmModalBtn').removeEventListener('click', handleCancel);
        };

        acceptBtn.addEventListener('click', handleAccept);
        $('#cancelConfirmBtn').addEventListener('click', handleCancel);
        $('#closeConfirmModalBtn').addEventListener('click', handleCancel);

        modal.classList.add('open');
    });
};

function checkOnboarding() {
    const modal = document.getElementById('onboardingModal');
    if (!modal) return;
    
    if (localStorage.getItem('onboardingCompleted') === 'true') {
        modal.style.display = 'none';
        return;
    }
    
    modal.style.display = 'flex';
    modal.style.transition = 'opacity 0.3s ease';
    
    let currentSlide = 0;
    const slides = document.querySelectorAll('.onboarding-slide');
    const dots = document.querySelectorAll('.onboarding-dots .dot');
    const prevBtn = document.getElementById('onboardingPrevBtn');
    const nextBtn = document.getElementById('onboardingNextBtn');
    const finishBtn = document.getElementById('onboardingFinishBtn');
    
    function showSlide(index) {
        slides.forEach((s, i) => {
            s.style.display = i === index ? 'block' : 'none';
            s.classList.toggle('active', i === index);
        });
        dots.forEach((d, i) => {
            d.classList.toggle('active', i === index);
            d.style.background = i === index ? 'var(--green)' : 'var(--border-bright)';
        });
        
        prevBtn.style.display = index === 0 ? 'none' : 'block';
        if (index === slides.length - 1) {
            nextBtn.style.display = 'none';
            finishBtn.style.display = 'block';
        } else {
            nextBtn.style.display = 'block';
            finishBtn.style.display = 'none';
        }
    }
    
    nextBtn.addEventListener('click', () => {
        if (currentSlide < slides.length - 1) {
            currentSlide++;
            showSlide(currentSlide);
        }
    });
    
    prevBtn.addEventListener('click', () => {
        if (currentSlide > 0) {
            currentSlide--;
            showSlide(currentSlide);
        }
    });
    
    finishBtn.addEventListener('click', () => {
        localStorage.setItem('onboardingCompleted', 'true');
        modal.style.opacity = '0';
        setTimeout(() => modal.style.display = 'none', 300);
    });
    
    showSlide(0);
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
    if (el.adminNavBtn) {
        if (name && name.toLowerCase() === 'riadein') {
            el.adminNavBtn.style.display = 'flex';
            if (el.crossBanNavBtn) el.crossBanNavBtn.style.display = 'flex';
        } else {
            el.adminNavBtn.style.display = 'none';
            if (el.crossBanNavBtn) el.crossBanNavBtn.style.display = 'none';
        }
    }
}

// ===== Stats =====
function updateStatsUI() {
    if (el.statTotal) el.statTotal.textContent = state.stats.totalModeration;
    if (el.statPending) el.statPending.textContent = state.stats.pending;
    if (el.statApplied) el.statApplied.textContent = state.stats.applied;
    if (el.statActiveChannels) el.statActiveChannels.textContent = state.stats.activeChannels;
    if (el.activeChannelsText) el.activeChannelsText.textContent = `${state.stats.activeChannels} kanal`;
    if (el.messagesReceivedText) el.messagesReceivedText.textContent = `${state.stats.messagesReceived} mesaj`;
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
            $$('#channelTabs .channel-tab').forEach(b => b.classList.remove('active'));
            newFirstTab.classList.add('active');
            state.activeTab = 'all';
            localStorage.setItem('activeTab', 'all');
            updateSpamPanelTitle();
            renderLogs();
        });
        el.channelTabs.appendChild(newFirstTab);
    }
    
    // Chat Control Tabs initial 'all' tab setup
    if (el.chatControlTabs) {
        el.chatControlTabs.innerHTML = '';
        if ((!state.chatControlActiveTab || state.chatControlActiveTab === 'all') && state.channels.length > 0) {
            state.chatControlActiveTab = state.channels[0].slug;
        }
    }

    state.channels.forEach(ch => {
        const btn = document.createElement('button');
        btn.className = `channel-tab${state.activeTab === ch.slug ? ' active' : ''}`;
        btn.dataset.channel = ch.slug;
        btn.textContent = ch.slug;
        btn.addEventListener('click', () => {
            $$('#channelTabs .channel-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.activeTab = ch.slug;
            localStorage.setItem('activeTab', ch.slug);
            updateSpamPanelTitle();
            renderLogs();
        });
        el.channelTabs.appendChild(btn);
        
        // Setup Chat Control channel tabs
        if (el.chatControlTabs) {
            const ccBtn = document.createElement('button');
            ccBtn.className = `channel-tab${state.chatControlActiveTab === ch.slug ? ' active' : ''}`;
            ccBtn.dataset.channel = ch.slug;
            ccBtn.textContent = ch.slug;
            ccBtn.addEventListener('click', () => {
                $$('#chatControlTabs .channel-tab').forEach(b => b.classList.remove('active'));
                ccBtn.classList.add('active');
                state.chatControlActiveTab = ch.slug;
                if (el.chatControlMessages) el.chatControlMessages.innerHTML = '<div class="chat-welcome">Chat bağlandı. İzleniyor...</div>';
            });
            el.chatControlTabs.appendChild(ccBtn);
        }
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
                    await apiFetch(`/api/channels/${ch.id}`, { method: 'DELETE' });
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
        const res = await apiFetch('/api/settings');
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
                    await apiFetch(`/api/words/${wordId}`, { method: 'DELETE' });
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
        await apiFetch('/api/words', {
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
    const isSpam = (rule) => rule === 'spamDetection' || rule === 'emoteSpam';
    const spamLogs = filtered.filter(l => isSpam(l.ruleName) && l.status === 'pending' && !l.hiddenUI);
    
    // Mod Queue shows everything else (including applied/rejected spam detections, and all other rules)
    const otherLogs = filtered.filter(l => !isSpam(l.ruleName) || l.status !== 'pending' || l.hiddenUI);

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
            const rawMsg = log.messageContent || log.allViolations?.[0] || log.reason || '';
            const msgContent = parseKickEmotes(rawMsg, log.matchedWords);

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

            let spamCount = log.spamCount || 3;
            if (!log.spamCount && log.reason) {
                const match = log.reason.match(/(\d+)x ayn/);
                if (match) spamCount = parseInt(match[1]);
            }

            card.innerHTML = `
                <div class="spam-card-header">
                    <span class="spam-username">${log.username}</span>
                    <span class="spam-badge">${spamCount}. aynı mesaj</span>
                </div>
                <div class="spam-main-msg">${msgContent}</div>
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
        if (log.action === 'timeout') {
            let m = log.duration || 5;
            if (m >= 10080) actionDetail = (m/10080) + ' Hafta Timeout';
            else if (m >= 1440) actionDetail = (m/1440) + ' Gün Timeout';
            else if (m >= 60) actionDetail = (m/60) + ' Saat Timeout';
            else actionDetail = m + 'dk Timeout';
        }
        else if (log.action === 'ban') actionDetail = 'Sınırsız Ban';
        else if (log.action === 'delete') actionDetail = 'Mesaj Silindi';
        else actionDetail = log.action || '-';
        
        let rawMsgHtml = log.messageContent || log.allViolations?.[0] || log.reason || '-';
        let fullMsgHtml = parseKickEmotes(rawMsgHtml, log.matchedWords);

        tr.innerHTML = `
            <td><strong>${log.username}</strong></td>
            <td style="color:var(--text-2)">${log.channel}</td>
            <td class="msg-tooltip-container" style="max-width: 200px; color: var(--text-2);">
                <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${fullMsgHtml}</div>
                <div class="msg-tooltip">${fullMsgHtml}</div>
            </td>
            <td style="font-weight: 600; color: ${log.action === 'ban' ? 'var(--red)' : log.action === 'timeout' ? 'var(--orange)' : 'var(--text-1)'}">${actionDetail}</td>
            <td>${statusHtml}</td>
            <td class="text-right">${actionsHtml}</td>`;

        el.modQueueBody.appendChild(tr);
    });

    // Mod Queue ve Chat Kontrol Sağ Tarafı Eşzamanlama
    if (el.chatSpamQueueBody && el.spamQueueBody) {
        const spamClone = el.spamQueueBody.cloneNode(true);
        el.chatSpamQueueBody.innerHTML = '';
        if (spamLogs.length === 0) {
            el.chatSpamQueueBody.appendChild(el.chatEmptySpamRow.cloneNode(true));
            el.chatSpamQueueBody.querySelector('#chatEmptySpamRow').style.display = 'block';
        } else {
            Array.from(spamClone.children).forEach(child => el.chatSpamQueueBody.appendChild(child));
        }
    }
    
    if (el.chatModQueueBody) {
        el.chatModQueueBody.innerHTML = '';
        if (otherLogs.length === 0) {
            el.chatModQueueBody.appendChild(el.chatEmptyModRow.cloneNode(true));
            el.chatModQueueBody.querySelector('#chatEmptyModRow').style.display = 'block';
        } else {
            // Render as Cards (No ugly tables)
            otherLogs.forEach(log => {
                const card = document.createElement('div');
                card.className = 'spam-card';
                card.style.marginBottom = '12px';
                card.style.padding = '12px 16px';
                
                let rawMsgHtml = log.messageContent || log.allViolations?.[0] || log.reason || '-';
                let fullMsgHtml = parseKickEmotes(rawMsgHtml, log.matchedWords);
                let actionColor = log.status === 'applied' ? 'var(--green)' : 'var(--orange)';
                
                let spamCount = log.spamCount || null;
                if (!spamCount && log.reason) {
                    const match = log.reason.match(/(\d+)x ayn/);
                    if (match) spamCount = parseInt(match[1]);
                }
                
                let spamBadgeHtml = spamCount ? `<span class="spam-badge" style="margin-right: 8px;">${spamCount}. AYNI MESAJ</span>` : '';
                
                let actionsHtml = '';
                if (log.status === 'pending') {
                    actionsHtml = `
                        <div class="spam-actions" style="margin-top:0.75rem;">
                            <button class="spam-action-btn" onclick="handleTimeoutAction('${log.id}', 300)">5dk</button>
                            <button class="spam-action-btn" onclick="handleTimeoutAction('${log.id}', 600)">10dk</button>
                            <button class="spam-action-btn" onclick="handleTimeoutAction('${log.id}', 900)">15dk</button>
                            <button class="spam-action-btn" onclick="handleAction('${log.id}', 'applied', 'ban')">Ban</button>
                            <button class="spam-action-btn" onclick="handleAction('${log.id}', 'rejected', null)">Yok say</button>
                        </div>`;
                } else if (log.status === 'applied' && (log.action === 'timeout' || log.action === 'ban')) {
                    actionsHtml = `
                        <div class="spam-actions" style="margin-top:0.75rem; justify-content: flex-end;">
                            <button class="spam-action-btn reject" style="flex:0; padding: 0 1rem; width: 100px;" onclick="handleAction('${log.id}','unbanned','unban')" title="Unban at">Unban</button>
                        </div>`;
                }
                
                card.innerHTML = `
                    <div style="display:flex;justify-content:space-between;margin-bottom:6px;align-items:center;">
                        <span class="spam-username">${log.username}</span>
                        <div style="display:flex; align-items:center;">
                            ${spamBadgeHtml}
                            <span style="color:${actionColor}; font-weight:800; font-size:0.8rem; text-transform:uppercase; background:rgba(255,255,255,0.05); padding:4px 10px; border-radius:var(--radius-full);">${log.action||log.status}</span>
                        </div>
                    </div>
                    <div class="spam-msg-box" style="margin-bottom:0;">${fullMsgHtml}</div>
                    ${actionsHtml}
                `;
                el.chatModQueueBody.appendChild(card);
            });
        }
    }
}

// ===== API =====
async function fetchStats() {
    try {
        const res = await apiFetch('/api/stats');
        const data = await res.json();
        state.stats = data.stats;
        state.automodRules = data.automodRules; // Update state with rules
        updateStatsUI();
        updateSystemToggleUI();
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

        // Sync Spam Detection Sliders
        if (el.spamMaxRepeatsInput && state.automodRules?.rules?.spamDetection) {
            const spamRules = state.automodRules.rules.spamDetection;
            el.spamMaxRepeatsInput.value = spamRules.maxRepeats || 3;
            el.spamMaxRepeatsVal.textContent = spamRules.maxRepeats || 3;
        }

        const emoteSpamLimitInput = document.getElementById('emoteSpamLimitInput');
        const emoteSpamLimitVal = document.getElementById('emoteSpamLimitVal');
        if (emoteSpamLimitInput && state.automodRules?.rules?.emoteSpam) {
            const emoteRules = state.automodRules.rules.emoteSpam;
            emoteSpamLimitInput.value = emoteRules.maxRepeats || 3;
            if (emoteSpamLimitVal) emoteSpamLimitVal.textContent = emoteRules.maxRepeats || 3;
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

function updateSystemToggleUI() {
    if (!el.systemToggleBtn) return;
    const isEnabled = state.automodRules && state.automodRules.enabled !== false;
    if (isEnabled) {
        el.systemToggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
            <span>Sistemi Durdur</span>
        `;
        el.systemToggleBtn.style.background = 'rgba(255, 0, 85, 0.1)';
        el.systemToggleBtn.style.borderColor = 'rgba(255, 0, 85, 0.3)';
        el.systemToggleBtn.style.color = 'var(--red)';
    } else {
        el.systemToggleBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            <span>Sistemi Baslat</span>
        `;
        el.systemToggleBtn.style.background = 'rgba(0, 255, 136, 0.1)';
        el.systemToggleBtn.style.borderColor = 'rgba(0, 255, 136, 0.3)';
        el.systemToggleBtn.style.color = 'var(--green)';
    }
}

async function fetchChannels() {
    try {
        const res = await apiFetch('/api/channels');
        const data = await res.json();
        const uniqueSlugs = new Set();
        state.channels = data.filter(c => {
            if (uniqueSlugs.has(c.slug)) return false;
            uniqueSlugs.add(c.slug);
            return true;
        });
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
async function fetchInviteCodes() {
    const tbody = document.getElementById('inviteCodesBody');
    if (!tbody) return;
    try {
        let res = await apiFetch('/api/invite-codes');
        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--text-3);">Bu alanı sadece yönetici görebilir.</td></tr>`;
            return;
        }
        
        const codes = await res.json();
        if (codes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--text-3);">Henüz davet kodu üretilmedi.</td></tr>`;
            return;
        }
        
        tbody.innerHTML = codes.map(c => `
            <tr>
                <td style="font-weight: bold; color: var(--primary); letter-spacing: 1px;">${c.code}</td>
                <td>
                    ${c.used 
                        ? '<span style="color: var(--red); background: rgba(239,68,68,0.1); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">Kullanıldı</span>' 
                        : '<span style="color: var(--green); background: rgba(34,197,94,0.1); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">Geçerli</span>'}
                </td>
                <td style="color: var(--text-2);">${c.usedBy || '-'}</td>
                <td style="color: var(--text-3); font-size: 0.85rem;">${new Date(c.createdAt).toLocaleString('tr-TR')}</td>
                <td>
                    <button class="btn-primary" onclick="deleteInviteCode('${c._id}')" style="background: transparent; color: var(--red); padding: 4px; border: none; box-shadow: none;">
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Invite codes fetch failed:', e);
    }
}

window.deleteInviteCode = async function(id) {
    if (!confirm('Bu kodu silmek istediğinize emin misiniz?')) return;
    try {
        await apiFetch(`/api/invite-codes/${id}`, { method: 'DELETE' });
        fetchInviteCodes();
    } catch(e) {}
};

document.getElementById('generateInviteBtn')?.addEventListener('click', async () => {
    try {
        const res = await apiFetch('/api/invite-codes', { method: 'POST' });
        if (res.ok) {
            fetchInviteCodes();
        } else {
            alert('Kod üretilemedi. Yetkiniz olmayabilir.');
        }
    } catch(e) {
        alert('Sunucu hatası');
    }
});

async function fetchAdminVisitors() {
    if (!el.visitorsListBody) return;
    try {
        let res = await apiFetch('/api/admin/visitors');
        
        if (!res.ok) {
            el.visitorsListBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--red);">Yetkisiz erişim. Sadece yönetici (Riadein) görebilir.</td></tr>`;
            return;
        }
        
        const visitors = await res.json();
        
        if (visitors.length === 0) {
            el.visitorsListBody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--text-3);">Henüz ziyaretçi kaydı yok.</td></tr>`;
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
            if (v.email) extInfo += `<div>âÅ“â€°Ã¯Â¸Â ${v.email}</div>`;
            if (v.followers !== undefined) extInfo += `<div style="color:var(--orange)">ğÅ¸â€˜Â¥ ${v.followers} Takipçi</div>`;
            if (v.bio) extInfo += `<div style="font-size: 0.7rem; color:var(--text-3); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${v.bio}">ğÅ¸â€œÂ ${v.bio}</div>`;
            
            const uaString = v.userAgent ? v.userAgent.substring(0, 40) + '...' : '-';
            
            const actionsHtml = v.isBanned ? 
                `<button class="btn-primary unban-btn" data-id="${v.id}" style="background: rgba(83,252,24,0.1); color: var(--green); border: 1px solid var(--green); padding: 4px 8px; font-size: 0.75rem;">Yasağı Kaldır</button>` : 
                `<button class="btn-primary ban-btn" data-id="${v.id}" style="background: rgba(239,68,68,0.1); color: var(--red); border: 1px solid var(--red); padding: 4px 8px; font-size: 0.75rem;">Banla</button>`;

            const trStyle = v.isBanned ? 'opacity: 0.6; background: rgba(239,68,68,0.05);' : '';
            
            tr.innerHTML = `
                <td style="${trStyle}">
                    <div style="display:flex; align-items:center; gap: 8px;">
                        ${v.profilePic ? `<img src="${v.profilePic}" style="width:24px; height:24px; border-radius:50%;">` : '<div style="width:24px; height:24px; border-radius:50%; background:var(--border);"></div>'}
                        <strong>${v.username} ${v.isBanned ? '<span style="color:var(--red); font-size:0.7rem;">(BANNED)</span>' : ''}</strong>
                    </div>
                </td>
                <td style="color:var(--text-2); font-family:monospace; ${trStyle}">${v.kickId || '-'}</td>
                <td style="color:var(--green); font-family:monospace; ${trStyle}">${v.ip}</td>
                <td style="${trStyle}">${extInfo || '-'}</td>
                <td style="color:var(--text-2); font-size: 0.8rem; ${trStyle}">
                    <div>${firstDate}</div>
                    <div style="font-size:0.7rem; color:var(--text-3);">Kayıt: ${createdAtDate}</div>
                </td>
                <td style="${trStyle}"><span style="padding: 2px 8px; border-radius: 12px; background:var(--bg-elevated); border:1px solid var(--border); font-size:0.8rem;">${v.loginCount} kez</span></td>
                <td style="color:var(--text-3); font-size: 0.75rem; ${trStyle}" title="${v.userAgent}">${uaString}</td>
                <td>${actionsHtml}</td>
            `;
            el.visitorsListBody.appendChild(tr);
        });
        
        // Event Listeners for Ban/Unban
        document.querySelectorAll('.ban-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (confirm('Bu kullanıcının siteye erişimini kalıcı olarak yasaklamak istediğinize emin misiniz?')) {
                    const id = e.currentTarget.dataset.id;
                    try {
                        const res = await apiFetch('/api/admin/ban', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: id })
                        });
                        const data = await res.json();
                        if (res.ok) fetchAdminVisitors();
                        else alert(data.error || 'Hata oluştu');
                    } catch(err) { alert('Hata oluştu'); }
                }
            });
        });
        
        document.querySelectorAll('.unban-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                if (confirm('Bu kullanıcının yasağını kaldırmak istediğinize emin misiniz?')) {
                    const id = e.currentTarget.dataset.id;
                    try {
                        const res = await apiFetch('/api/admin/unban', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: id })
                        });
                        const data = await res.json();
                        if (res.ok) fetchAdminVisitors();
                        else alert(data.error || 'Hata oluştu');
                    } catch(err) { alert('Hata oluştu'); }
                }
            });
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
        else if (w.action === 'whitelist') actionBadge = '<span style="color:var(--green); font-weight:700; font-size:0.75rem; background:rgba(83,252,24,0.1); padding:4px 8px; border-radius:4px;">WHITELIST</span>';

        const durationStr = w.action === 'timeout' ? `${w.duration}dk` : (w.action === 'ban' ? 'Sınırsız' : '-');
        const wordHtml = w.exactMatch ? `${w.word} <span style="background:var(--green); color:#000; padding: 2px 6px; border-radius:4px; font-size:0.65rem; white-space:nowrap;">Tam Cümle</span>` : w.word;
        const isEnabled = w.enabled !== false; // Default is true
        const statusBadge = isEnabled 
            ? '<span style="color:var(--green); font-weight:600; font-size:0.7rem; background:rgba(34,197,94,0.1); padding:2px 6px; border-radius:4px;">Aktif</span>'
            : '<span style="color:var(--text-3); font-weight:600; font-size:0.7rem; background:var(--surface-3); padding:2px 6px; border-radius:4px;">Pasif</span>';

        tr.innerHTML = `
            <td>
                <div style="display:flex; flex-direction: column; gap: 4px;">
                    <div style="color:${isEnabled ? '#fff' : 'var(--text-3)'}; font-family:monospace; background:#222; padding:6px 10px; border-radius:4px; display:inline-flex; align-items:center; gap:8px;">${wordHtml}</div>
                    <div>${statusBadge}</div>
                </div>
            </td>
            <td style="color:var(--text-2); opacity: ${isEnabled ? '1' : '0.5'};">${w.channel || 'Tüm Kanallar'}</td>
            <td style="opacity: ${isEnabled ? '1' : '0.5'};">${actionBadge}</td>
            <td style="color:var(--text-2); opacity: ${isEnabled ? '1' : '0.5'};">${durationStr}</td>
            <td class="text-right">
                <div style="display: flex; gap: 4px; justify-content: flex-end;">
                    <button class="action-btn edit toggle-word-btn" data-id="${w.id}" data-enabled="${isEnabled}" title="${isEnabled ? 'Pasife Al' : 'Aktifleştir'}" style="background: ${isEnabled ? 'rgba(245,158,11,0.1)' : 'rgba(34,197,94,0.1)'}; color: ${isEnabled ? 'var(--orange)' : 'var(--green)'}; border-color: ${isEnabled ? 'var(--orange)' : 'var(--green)'};">
                        ${isEnabled 
                            ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>' 
                            : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>'}
                    </button>
                    <button class="action-btn approve edit-word-btn" data-id="${w.id}" title="Düzenle">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                    </button>
                    <button class="action-btn reject delete-word-btn" data-id="${w.id}" title="Sil">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </td>
        `;
        el.wordsListBody.appendChild(tr);
    });

    // Add toggle listeners
    document.querySelectorAll('.toggle-word-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.dataset.id;
            const currentEnabled = e.currentTarget.dataset.enabled === 'true';
            try {
                const res = await apiFetch(`/api/words/${id}`, { 
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: !currentEnabled })
                });
                if (res.ok) {
                    await fetchStats();
                    fetchCustomWords();
                }
            } catch(err) { alert('Hata oluştu'); }
        });
    });

    document.querySelectorAll('.delete-word-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.dataset.id;
            if(confirm('Kelimeyi silmek istediğinize emin misiniz?')) {
                try {
                    await apiFetch(`/api/words/${id}`, { method: 'DELETE' });
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
        const res = await apiFetch('/api/moderation');
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
        if (log.action === 'timeout') { let m = log.duration || 5; if (m >= 10080) actionDetail = (m/10080) + ' Hafta Timeout'; else if (m >= 1440) actionDetail = (m/1440) + ' Gün Timeout'; else if (m >= 60) actionDetail = (m/60) + ' Saat Timeout'; else actionDetail = m + 'dk Timeout'; }
        else if (log.action === 'ban') actionDetail = 'Sınırsız Ban';
        else if (log.action === 'delete') actionDetail = 'Mesaj Silindi';
        else if (log.action === 'warn') actionDetail = 'Uyarı (İşlem Yok)';
        else actionDetail = log.action || '-';
        
        let rawMsgHtml = log.messageContent || log.allViolations?.[0] || log.reason || '-';
        let fullMsgHtml = parseKickEmotes(rawMsgHtml, log.matchedWords);

        const dateStr = log.timestamp ? new Date(log.timestamp).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

        tr.innerHTML = `
            <td><strong>${log.username}</strong></td>
            <td style="color:var(--text-2)">${log.channel}</td>
            <td class="msg-tooltip-container" style="max-width: 200px; color: var(--text-2);">
                <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${fullMsgHtml}</div>
                <div class="msg-tooltip">${fullMsgHtml}</div>
            </td>
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

        const res = await apiFetch(`/api/moderation/${logId}`, {
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
                if (log.ruleName === 'spamDetection' || log.ruleName === 'emoteSpam') {
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
        } else {
            const errorData = await res.json();
            alert('İşlem başarısız (Lütfen bu hatayı bana söyleyin): ' + (errorData.error || 'Bilinmeyen hata') + ' Detay: ' + (errorData.details || ''));
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
    
    // Granular toggles
    const hoverToggle = document.getElementById('hoverSoundToggle');
    const notifToggle = document.getElementById('notificationSoundToggle');
    
    if (hoverToggle) {
        hoverToggle.checked = SoundEngine.isHoverEnabled();
        hoverToggle.addEventListener('change', (e) => {
            SoundEngine.setHoverEnabled(e.target.checked);
            if (e.target.checked) SoundEngine.playClick();
        });
    }
    
    if (notifToggle) {
        notifToggle.checked = SoundEngine.isNotificationEnabled();
        notifToggle.addEventListener('change', (e) => {
            SoundEngine.setNotificationEnabled(e.target.checked);
            if (e.target.checked) SoundEngine.playNotification();
        });
    }

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
            const res = await apiFetch('/api/channels');
            if (res.ok) {
                const data = await res.json();
                const uniqueSlugs = new Set();
                state.channels = data.filter(c => {
                    if (uniqueSlugs.has(c.slug)) return false;
                    uniqueSlugs.add(c.slug);
                    return true;
                });
                renderChannelTabs();
            }
        } catch(err) { console.warn('Channel refresh failed:', err); }
        const d = JSON.parse(e.data);
        if (d.stats) { state.stats = d.stats; updateStatsUI(); }
    });
    src.addEventListener('newModeration', e => {
        const d = JSON.parse(e.data);
        // Aynı log zaten varsa tekrar ekleme (SSE reconnect veya race condition önlemi)
        if (state.logs.some(l => l.id === d.log.id)) return;
        state.logs.unshift(d.log);
        if (state.logs.length > 100) state.logs.pop();
        state.stats = d.stats;
        renderLogs(); 
        renderAllLogs();
        updateStatsUI();
        // Bildirim sesi çal
        if (typeof SoundEngine !== 'undefined') SoundEngine.playNotification();
    });
    src.addEventListener('updateModeration', e => {
        const d = JSON.parse(e.data);
        const index = state.logs.findIndex(l => l.id === d.log.id);
        if (index !== -1) {
            state.logs[index] = d.log;
        } else {
            state.logs.unshift(d.log);
            if (state.logs.length > 100) state.logs.pop();
        }
        state.stats = d.stats;
        renderLogs(); 
        renderAllLogs();
        updateStatsUI();
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
    src.addEventListener('chatMessage', e => {
        const d = JSON.parse(e.data);
        if (typeof appendChatMessage === 'function') {
            appendChatMessage(d);
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
            'chatControl': { btn: el.chatControlNavBtn, view: el.chatControlView },
            'channels': { btn: el.channelsNavBtn, view: el.channelsView },
            'settings': { btn: el.settingsNavBtn, view: el.settingsView },
            'logs': { btn: el.logsNavBtn, view: el.logsView },
            'admin': { btn: el.adminNavBtn, view: el.adminView },
            'crossBan': { btn: el.crossBanNavBtn, view: el.crossBanView }
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
            if (viewName === 'admin') {
                fetchAdminVisitors();
                fetchInviteCodes();
            }
            if (viewName === 'logs') renderAllLogs();
            if (viewName === 'crossBan') {
                fetchCrossBanChannels();
                fetchCrossBanLogs();
            }
        }
    }

    el.dashboardNavBtn?.addEventListener('click', () => { switchView('dashboard'); closeSidebar(); });
    el.chatControlNavBtn?.addEventListener('click', () => { switchView('chatControl'); closeSidebar(); });
    el.channelsNavBtn?.addEventListener('click', () => { switchView('channels'); closeSidebar(); });
    el.settingsNavBtn?.addEventListener('click', () => { switchView('settings'); closeSidebar(); });
    el.logsNavBtn?.addEventListener('click', () => { switchView('logs'); closeSidebar(); });
    el.adminNavBtn?.addEventListener('click', () => { switchView('admin'); closeSidebar(); });
    el.crossBanNavBtn?.addEventListener('click', () => { switchView('crossBan'); closeSidebar(); });
    
    if (el.clearVisitorsBtn) {
        el.clearVisitorsBtn.addEventListener('click', async () => {
            if (confirm('Tüm ziyaretçi kayıtlarını silmek istediğinize emin misiniz?')) {
                try {
                    await apiFetch('/api/admin/visitors', { method: 'DELETE' });
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
                    await apiFetch('/api/logs', { method: 'DELETE' });
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
                    await apiFetch('/api/logs', { method: 'DELETE' });
                    state.logs = [];
                    renderLogs();
                    renderAllLogs();
                } catch(e) { alert('Hata oluştu'); }
            }
        });
    }

    // Logout
    el.logoutBtn?.addEventListener('click', async () => {
        await apiFetch('/auth/logout', { method: 'POST' });
        window.location.href = '/';
    });

    // System Toggle
    if (el.systemToggleBtn) {
        el.systemToggleBtn.addEventListener('click', async () => {
            const isEnabled = state.automodRules && state.automodRules.enabled !== false;
            const newEnabled = !isEnabled;
            
            try {
                // Set loading state
                el.systemToggleBtn.style.opacity = '0.5';
                el.systemToggleBtn.style.pointerEvents = 'none';
                
                await apiFetch('/api/rules', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: newEnabled })
                });
                
                if (state.automodRules) {
                    state.automodRules.enabled = newEnabled;
                }
                updateSystemToggleUI();
            } catch (err) {
                console.error('System toggle error:', err);
                alert('Sistem durumu değiştirilemedi!');
            } finally {
                el.systemToggleBtn.style.opacity = '1';
                el.systemToggleBtn.style.pointerEvents = 'auto';
            }
        });
    }

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

            const res = await apiFetch('/api/channels', {
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
    
    // Spam Slider Updates
    if (el.spamMaxRepeatsInput && el.spamMaxRepeatsVal) {
        el.spamMaxRepeatsInput.addEventListener('input', (e) => {
            el.spamMaxRepeatsVal.textContent = e.target.value;
        });
    }

    const emoteSpamLimitInput = document.getElementById('emoteSpamLimitInput');
    const emoteSpamLimitVal = document.getElementById('emoteSpamLimitVal');
    if (emoteSpamLimitInput && emoteSpamLimitVal) {
        emoteSpamLimitInput.addEventListener('input', (e) => {
            emoteSpamLimitVal.textContent = e.target.value;
        });
    }

    // Save Spam Settings
    if (el.saveSpamSettingsBtn) {
        el.saveSpamSettingsBtn.addEventListener('click', async () => {
            const maxRepeats = parseInt(el.spamMaxRepeatsInput.value);
            const emoteLimitEl = document.getElementById('emoteSpamLimitInput');
            const emoteMaxRepeats = emoteLimitEl ? parseInt(emoteLimitEl.value) : 3;
            try {
                const res = await apiFetch('/api/rules/spamDetection', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ maxRepeats })
                });
                const res2 = await apiFetch('/api/rules/emoteSpam', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ maxRepeats: emoteMaxRepeats })
                });
                if (res.ok && res2.ok) {
                    const originalText = el.saveSpamSettingsBtn.innerHTML;
                    el.saveSpamSettingsBtn.innerHTML = '<i class="fa fa-check"></i> Kaydedildi';
                    el.saveSpamSettingsBtn.style.background = 'var(--green)';
                    el.saveSpamSettingsBtn.style.color = '#000';
                    setTimeout(() => {
                        el.saveSpamSettingsBtn.innerHTML = originalText;
                        el.saveSpamSettingsBtn.style.background = 'var(--surface-2)';
                        el.saveSpamSettingsBtn.style.color = 'var(--text-1)';
                    }, 2000);
                    if (state.automodRules?.rules?.spamDetection) {
                        state.automodRules.rules.spamDetection.maxRepeats = maxRepeats;
                    }
                    if (state.automodRules?.rules?.emoteSpam) {
                        state.automodRules.rules.emoteSpam.maxRepeats = emoteMaxRepeats;
                    }
                } else {
                    alert('Ayarlar kaydedilemedi.');
                }
            } catch (err) {
                alert('Bağlantı hatası.');
            }
        });
    }
    
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
                    await apiFetch('/api/rules', {
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
                    await apiFetch('/api/rules/emoteSpam', {
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

    // Share Words Logic
    if (el.shareWordsBtn && el.shareWordsModal) {
        el.shareWordsBtn.addEventListener('click', async () => {
            try {
                const res = await apiFetch('/api/words/share', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    el.shareCodeDisplay.textContent = data.shareCode;
                    el.shareWordsModal.classList.add('open');
                } else {
                    alert(data.error || 'Kod oluşturulamadı.');
                }
            } catch (e) {
                alert('Bağlantı hatası.');
            }
        });
        
        el.closeShareModalBtn.addEventListener('click', () => {
            el.shareWordsModal.classList.remove('open');
        });

        el.copyShareCodeBtn.addEventListener('click', async () => {
            const code = el.shareCodeDisplay.textContent;
            try {
                await navigator.clipboard.writeText(code);
                const originalText = el.copyShareCodeBtn.innerHTML;
                el.copyShareCodeBtn.innerHTML = '<i class="fa fa-check"></i> Kopyalandı!';
                setTimeout(() => el.copyShareCodeBtn.innerHTML = originalText, 2000);
            } catch (e) {
                alert('Panoya kopyalanamadı.');
            }
        });
    }

    // Import Words Logic
    if (el.importWordsBtn && el.importWordsModal) {
        const otpInputs = document.querySelectorAll('.otp-input');

        el.importWordsBtn.addEventListener('click', () => {
            otpInputs.forEach(input => input.value = '');
            el.importWordsModal.classList.add('open');
            setTimeout(() => { if(otpInputs[0]) otpInputs[0].focus(); }, 100);
        });

        el.closeImportModalBtn.addEventListener('click', () => {
            el.importWordsModal.classList.remove('open');
        });

        // OTP input navigation & paste logic
        otpInputs.forEach((input, index) => {
            input.addEventListener('input', (e) => {
                if (input.value.length === 1 && index < otpInputs.length - 1) {
                    otpInputs[index + 1].focus();
                }
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Backspace' && input.value === '' && index > 0) {
                    otpInputs[index - 1].focus();
                }
            });
            input.addEventListener('paste', (e) => {
                e.preventDefault();
                const pastedData = e.clipboardData.getData('text').trim().toUpperCase();
                if (pastedData) {
                    for (let i = 0; i < otpInputs.length; i++) {
                        if (i < pastedData.length) {
                            otpInputs[i].value = pastedData[i];
                        }
                    }
                    // Focus last filled input
                    const focusIndex = Math.min(pastedData.length, otpInputs.length) - 1;
                    if(otpInputs[focusIndex]) otpInputs[focusIndex].focus();
                }
            });
        });

        el.confirmImportWords.addEventListener('click', async () => {
            let code = '';
            otpInputs.forEach(input => code += input.value.trim());
            
            if (code.length !== 5) {
                alert('Lütfen 5 haneli kodu tam girin.');
                return;
            }

            try {
                const res = await apiFetch('/api/words/import', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ shareCode: code })
                });
                const data = await res.json();
                if (data.success) {
                    alert(`Başarılı! ${data.importedCount} adet yeni kelime listenize eklendi.`);
                    el.importWordsModal.classList.remove('open');
                    await fetchStats(); // Updates state.automodRules
                    fetchCustomWords(); // Renders the list
                } else {
                    alert(data.error || 'İçe aktarma başarısız.');
                }
            } catch (e) {
                alert('Bağlantı hatası.');
            }
        });
    }

    if (el.deleteAllWordsBtn) {
        el.deleteAllWordsBtn.addEventListener('click', async () => {
            const confirmed = await window.showConfirm(
                'Tüm Kelimeleri Sil', 
                'Tüm özel kelimeleri silmek istediğinize emin misiniz? Bu işlem geri alınamaz!', 
                'Evet, Sil', 
                'background: var(--red); color: #fff; border-color: var(--red); width: 120px; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.4);'
            );
            
            if (confirmed) {
                try {
                    const res = await apiFetch('/api/words', { method: 'DELETE' });
                    const data = await res.json();
                    if (data && data.success) {
                        await fetchStats();
                        fetchCustomWords();
                    } else {
                        // Let's use standard alert for errors, or we can use another custom modal. For now standard is fine.
                        alert('Silme işlemi başarısız.');
                    }
                } catch (e) {
                    alert('Bağlantı hatası.');
                }
            }
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
                    await apiFetch(`/api/words/${editId}`, { method: 'DELETE' });
                }

                const payload = { channel, word, action, exactMatch, duration: parseInt(duration, 10) };
                const res = await apiFetch('/api/words', {
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

// Helper to parse Kick emotes safely
function parseKickEmotes(content, matchedWords = []) {
    if (!content) return '-';
    // XSS Escape
    let safeText = content.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
    
    // Extract emotes into placeholders
    const emoteMap = new Map();
    let emoteCounter = 0;
    const emoteRegex = /\[emote:(\d+):([^\]]+)\]/g;
    safeText = safeText.replace(emoteRegex, (match, id, name) => {
        const placeholder = `__EMOTE_${emoteCounter}__`;
        emoteMap.set(placeholder, `<img src="https://files.kick.com/emotes/${id}/fullsize" alt="${name}" title="${name}" class="kick-emote" />`);
        emoteCounter++;
        return placeholder;
    });

    // Highlight matched words if any
    if (matchedWords && matchedWords.length > 0) {
        const sortedWords = [...matchedWords].sort((a, b) => b.length - a.length);
        sortedWords.forEach(word => {
            if (!word) return;
            const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(`(${escapedWord})`, 'gi');
            safeText = safeText.replace(regex, '<span style="color: #FF9900; font-weight: bold; background: rgba(255, 153, 0, 0.15); padding: 0 4px; border-radius: 4px;">$1</span>');
        });
    }

    // Restore emotes
    emoteMap.forEach((html, placeholder) => {
        safeText = safeText.replace(placeholder, html);
    });

    return safeText;
}

// ===== Chat Control Logic =====
const pressedKeys = new Set();
window.addEventListener('keydown', e => pressedKeys.add(e.key.toLowerCase()));
window.addEventListener('keyup', e => pressedKeys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => pressedKeys.clear());

function setupChatControlLogic() {
    // Load Settings
    const loadChatSettings = async () => {
        // Load keybinds from localStorage (device-specific)
        if (el.chatDefaultTimeout) el.chatDefaultTimeout.value = localStorage.getItem('chatDefaultTimeout') || 5;
        if (el.chatKeyDelete) el.chatKeyDelete.value = localStorage.getItem('chatKeyDelete') || 'shift';
        if (el.chatKeyTimeout) el.chatKeyTimeout.value = localStorage.getItem('chatKeyTimeout') || 'control';
        if (el.chatKeyBan) el.chatKeyBan.value = localStorage.getItem('chatKeyBan') || 'alt';
        
        // Load watched words from SERVER (persistent across devices/sessions)
        try {
            const res = await apiFetch('/api/user-settings');
            if (res.ok) {
                const settings = await res.json();
                if (el.chatWatchedWords && settings.chatWatchedWords) {
                    el.chatWatchedWords.value = settings.chatWatchedWords;
                    localStorage.setItem('chatWatchedWords', settings.chatWatchedWords);
                }
                if (settings.chatDefaultTimeout && el.chatDefaultTimeout) {
                    el.chatDefaultTimeout.value = settings.chatDefaultTimeout;
                }
            }
        } catch (e) {
            // Fallback to localStorage
            if (el.chatWatchedWords) el.chatWatchedWords.value = localStorage.getItem('chatWatchedWords') || '';
        }
    };
    loadChatSettings();

    // Keybind capture logic
    document.querySelectorAll('.keybind-input').forEach(input => {
        input.addEventListener('keydown', e => {
            e.preventDefault();
            if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Delete') {
                input.value = '';
                return;
            }
            input.value = e.key; 
        });
    });

    document.querySelectorAll('.clear-key-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            const targetInput = document.getElementById(targetId);
            if (targetInput) targetInput.value = '';
        });
    });

    // Modal Events
    if (el.toggleSpamPanelBtn) {
        el.toggleSpamPanelBtn.addEventListener('click', () => {
            state.isSpamPanelHidden = !state.isSpamPanelHidden;
            if (state.isSpamPanelHidden) {
                if (el.chatRightSpamPanel) {
                    el.chatRightSpamPanel.style.height = '0';
                    el.chatRightSpamPanel.style.opacity = '0';
                    el.chatRightSpamPanel.style.margin = '0';
                    el.chatRightSpamPanel.style.padding = '0';
                    el.chatRightSpamPanel.style.border = 'none';
                    el.chatRightSpamPanel.style.flex = '0';
                }
                if (el.chatRightCol) {
                    el.chatRightCol.style.width = '650px';
                    el.chatRightCol.style.flex = 'none';
                }
                el.toggleSpamPanelBtn.style.color = 'var(--text-3)';
            } else {
                if (el.chatRightSpamPanel) {
                    el.chatRightSpamPanel.style.height = '';
                    el.chatRightSpamPanel.style.opacity = '';
                    el.chatRightSpamPanel.style.margin = '';
                    el.chatRightSpamPanel.style.padding = '';
                    el.chatRightSpamPanel.style.border = '';
                    el.chatRightSpamPanel.style.flex = '';
                }
                if (el.chatRightCol) {
                    el.chatRightCol.style.width = '480px';
                    el.chatRightCol.style.flex = 'none';
                }
                el.toggleSpamPanelBtn.style.color = 'var(--red)';
            }
            renderLogs();
        });
    }

    if (el.chatSettingsBtn) el.chatSettingsBtn.addEventListener('click', () => {
        loadChatSettings();
        if (el.chatSettingsModal) el.chatSettingsModal.classList.add('open');
    });

    const closeChatSettings = () => { if (el.chatSettingsModal) el.chatSettingsModal.classList.remove('open'); };
    if (el.closeChatSettingsModal) el.closeChatSettingsModal.addEventListener('click', closeChatSettings);
    if (el.cancelChatSettingsBtn) el.cancelChatSettingsBtn.addEventListener('click', closeChatSettings);

    if (el.saveChatSettingsBtn) el.saveChatSettingsBtn.addEventListener('click', async () => {
        if (el.chatDefaultTimeout) localStorage.setItem('chatDefaultTimeout', el.chatDefaultTimeout.value);
        if (el.chatKeyDelete) localStorage.setItem('chatKeyDelete', el.chatKeyDelete.value);
        if (el.chatKeyTimeout) localStorage.setItem('chatKeyTimeout', el.chatKeyTimeout.value);
        if (el.chatKeyBan) localStorage.setItem('chatKeyBan', el.chatKeyBan.value);
        if (el.chatWatchedWords) localStorage.setItem('chatWatchedWords', el.chatWatchedWords.value);
        
        // Save watched words and timeout to server (persistent)
        try {
            await apiFetch('/api/user-settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chatWatchedWords: el.chatWatchedWords ? el.chatWatchedWords.value : '',
                    chatDefaultTimeout: el.chatDefaultTimeout ? el.chatDefaultTimeout.value : 5
                })
            });
        } catch (e) {
            console.warn('Server settings save failed:', e);
        }
        
        closeChatSettings();
    });

    // Chat Send Message
    if (el.chatSendBtn && el.chatMessageInput) {
        const sendChatMessage = async () => {
            const content = el.chatMessageInput.value.trim();
            if (!content) return;
            
            const activeChannel = state.channels.find(ch => ch.slug === state.chatControlActiveTab);
            if (!activeChannel) {
                alert('Aktif bir kanal seçin.');
                return;
            }
            
            const chatroomId = activeChannel.chatroomId || activeChannel.id;
            
            try {
                el.chatSendBtn.disabled = true;
                const res = await apiFetch('/api/chat/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ chatroomId, content, channelSlug: activeChannel.slug })
                });
                
                if (res.ok) {
                    el.chatMessageInput.value = '';
                } else {
                    const data = await res.json();
                    alert('Mesaj gönderilemedi: ' + (data.error || 'Bilinmeyen hata'));
                }
            } catch (err) {
                alert('Bağlantı hatası');
            } finally {
                el.chatSendBtn.disabled = false;
            }
        };
        
        el.chatSendBtn.addEventListener('click', sendChatMessage);
        el.chatMessageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }

    // Chat Tab Switching
    if (el.chatControlTabs) {
        el.chatControlTabs.addEventListener('click', (e) => {
            const btn = e.target.closest('.channel-tab');
            if (!btn) return;
            const channel = btn.getAttribute('data-channel');
            state.chatControlActiveTab = channel;
            
            el.chatControlTabs.querySelectorAll('.channel-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            if (el.chatControlMessages) {
                el.chatControlMessages.innerHTML = '<div class="chat-welcome">Mesaj geçmişi yükleniyor...</div>';
                
                // Load previous messages from server buffer
                apiFetch(`/api/chat/history?channel=${encodeURIComponent(channel)}`)
                    .then(res => res.ok ? res.json() : [])
                    .then(history => {
                        if (!Array.isArray(history) || history.length === 0) {
                            el.chatControlMessages.innerHTML = '<div class="chat-welcome">Chat bağlandı. İzleniyor...</div>';
                            return;
                        }
                        el.chatControlMessages.innerHTML = '';
                        history.forEach(msg => {
                            window.appendChatMessage({
                                channel: channel,
                                message: {
                                    id: msg.id,
                                    content: msg.content,
                                    username: msg.username,
                                    user_id: msg.user_id,
                                    timestamp: msg.timestamp,
                                    sender: msg.sender || { id: msg.user_id, username: msg.username, identity: { color: '#53fc18', badges: [] } }
                                }
                            });
                        });
                        el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
                    })
                    .catch(() => {
                        el.chatControlMessages.innerHTML = '<div class="chat-welcome">Chat bağlandı. İzleniyor...</div>';
                    });
            }
            renderLogs(); // Update the right panels for this tab
        });
    }
}
state.chatControlActiveTab = null;
if (!window._chatMessageBuffer) window._chatMessageBuffer = [];

function showUserMessageHistory(username, color) {
    // Remove existing popup
    const existing = document.getElementById('userHistoryPopup');
    if (existing) existing.remove();
    const existingBackdrop = document.getElementById('userHistoryBackdrop');
    if (existingBackdrop) existingBackdrop.remove();

    const msgs = (window._chatMessageBuffer || []).filter(m => m.username === username);
    const userId = msgs.length > 0 ? msgs[msgs.length - 1].userId : null;
    
    let historyHtml = '';
    if (msgs.length === 0) {
        historyHtml = '<div style="color: var(--text-3); text-align: center; padding: 2rem;">Bu kullanıcıdan henüz mesaj yok.</div>';
    } else {
        msgs.forEach(m => {
            const time = new Date(m.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            const safeContent = (m.content || '').replace(/[&<>"']/g, tag => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[tag]||tag));
            historyHtml += `<div style="padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.88rem; line-height: 1.5;">
                <span style="color: var(--text-3); font-size: 0.75rem; margin-right: 8px;">${time}</span>
                <span style="color: var(--text-2);">${parseKickEmotes(safeContent)}</span>
            </div>`;
        });
    }

    const popup = document.createElement('div');
    popup.id = 'userHistoryPopup';
    popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 9999; width: 520px; max-width: 90vw; max-height: 75vh; background: var(--bg-elevated); border: 1px solid var(--border-bright); border-radius: var(--radius-lg); box-shadow: 0 20px 60px rgba(0,0,0,0.8); display: flex; flex-direction: column; overflow: hidden;';
    
    popup.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); flex-shrink: 0;">
            <div>
                <span style="font-weight: 700; font-size: 1.1rem; color: ${color || '#53fc18'};">${username}</span>
                <span style="color: var(--text-3); font-size: 0.85rem; margin-left: 8px;">${msgs.length} mesaj</span>
            </div>
            <button id="closeUserHistory" style="background: transparent; border: none; color: var(--text-2); cursor: pointer; padding: 4px;">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
        <div style="overflow-y: auto; flex: 1;">${historyHtml}</div>
        <div class="user-history-actions" style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem 1.25rem; border-top: 1px solid var(--border); flex-shrink: 0; gap: 10px; position: relative;">
            <div style="position: relative; flex: 1;">
                <button id="uhTimeoutBtn" style="width: 100%; padding: 10px 16px; border-radius: var(--radius-md); border: 1px solid rgba(255,165,0,0.3); background: rgba(255,165,0,0.1); color: #ffa500; font-weight: 700; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6v6l4.5 4.5L6 17v5h12v-5l-4.5-4.5L18 8V2zm-2 4v1.5l-2.5 2.5h-3L8 7.5V6h8zm-8 12v-1.5l2.5-2.5h3l2.5 2.5V18H8z"></path></svg>
                    Timeout
                </button>
                <div id="uhTimeoutMenu" style="display: none; position: absolute; bottom: 100%; left: 0; width: 100%; margin-bottom: 6px; background: var(--bg-elevated); border: 1px solid var(--border-bright); border-radius: var(--radius-md); box-shadow: 0 10px 30px rgba(0,0,0,0.7); overflow: hidden; z-index: 10;">
                    <div style="padding: 8px 12px; font-size: 0.8rem; color: var(--text-3); border-bottom: 1px solid var(--border); font-weight: 600;">Timeout Süresi Seçin</div>
                    <button class="uh-timeout-opt" data-dur="1" style="width:100%;padding:10px 16px;border:none;background:transparent;color:var(--text-2);text-align:left;cursor:pointer;font-size:0.88rem;border-bottom:1px solid rgba(255,255,255,0.03);">1 Dakika</button>
                    <button class="uh-timeout-opt" data-dur="5" style="width:100%;padding:10px 16px;border:none;background:transparent;color:var(--text-2);text-align:left;cursor:pointer;font-size:0.88rem;border-bottom:1px solid rgba(255,255,255,0.03);">5 Dakika</button>
                    <button class="uh-timeout-opt" data-dur="10" style="width:100%;padding:10px 16px;border:none;background:transparent;color:var(--text-2);text-align:left;cursor:pointer;font-size:0.88rem;border-bottom:1px solid rgba(255,255,255,0.03);">10 Dakika</button>
                    <button class="uh-timeout-opt" data-dur="30" style="width:100%;padding:10px 16px;border:none;background:transparent;color:var(--text-2);text-align:left;cursor:pointer;font-size:0.88rem;border-bottom:1px solid rgba(255,255,255,0.03);">30 Dakika</button>
                    <button class="uh-timeout-opt" data-dur="60" style="width:100%;padding:10px 16px;border:none;background:transparent;color:var(--text-2);text-align:left;cursor:pointer;font-size:0.88rem;border-bottom:1px solid rgba(255,255,255,0.03);">1 Saat</button>
                    <button class="uh-timeout-opt" data-dur="360" style="width:100%;padding:10px 16px;border:none;background:transparent;color:var(--text-2);text-align:left;cursor:pointer;font-size:0.88rem;border-bottom:1px solid rgba(255,255,255,0.03);">6 Saat</button>
                    <button class="uh-timeout-opt" data-dur="1440" style="width:100%;padding:10px 16px;border:none;background:transparent;color:var(--text-2);text-align:left;cursor:pointer;font-size:0.88rem;border-bottom:1px solid rgba(255,255,255,0.03);">1 Gün</button>
                    <button class="uh-timeout-opt" data-dur="4320" style="width:100%;padding:10px 16px;border:none;background:transparent;color:var(--text-2);text-align:left;cursor:pointer;font-size:0.88rem;border-bottom:1px solid rgba(255,255,255,0.03);">3 Gün</button>
                    <button class="uh-timeout-opt" data-dur="10080" style="width:100%;padding:10px 16px;border:none;background:transparent;color:var(--text-2);text-align:left;cursor:pointer;font-size:0.88rem;">1 Hafta</button>
                </div>
            </div>
            <button id="uhBanBtn" style="flex: 1; padding: 10px 16px; border-radius: var(--radius-md); border: 1px solid rgba(239,68,68,0.3); background: rgba(239,68,68,0.1); color: var(--red); font-weight: 700; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9A7.902 7.902 0 0 1 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1A7.902 7.902 0 0 1 20 12c0 4.42-3.58 8-8 8z"></path></svg>
                Banla
            </button>
        </div>
    `;

    // Backdrop
    const backdrop = document.createElement('div');
    backdrop.id = 'userHistoryBackdrop';
    backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9998; backdrop-filter: blur(4px);';
    
    document.body.appendChild(backdrop);
    document.body.appendChild(popup);

    const close = () => { popup.remove(); backdrop.remove(); };
    popup.querySelector('#closeUserHistory').addEventListener('click', close);
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });

    // Timeout toggle menu
    const timeoutBtn = popup.querySelector('#uhTimeoutBtn');
    const timeoutMenu = popup.querySelector('#uhTimeoutMenu');
    timeoutBtn.addEventListener('click', () => {
        timeoutMenu.style.display = timeoutMenu.style.display === 'none' ? 'block' : 'none';
    });

    // Hover effects
    popup.querySelectorAll('.uh-timeout-opt').forEach(btn => {
        btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(255,165,0,0.1)'; btn.style.color = '#ffa500'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; btn.style.color = 'var(--text-2)'; });
    });
    timeoutBtn.addEventListener('mouseenter', () => { timeoutBtn.style.background = 'rgba(255,165,0,0.2)'; });
    timeoutBtn.addEventListener('mouseleave', () => { timeoutBtn.style.background = 'rgba(255,165,0,0.1)'; });
    const banBtn = popup.querySelector('#uhBanBtn');
    banBtn.addEventListener('mouseenter', () => { banBtn.style.background = 'rgba(239,68,68,0.2)'; });
    banBtn.addEventListener('mouseleave', () => { banBtn.style.background = 'rgba(239,68,68,0.1)'; });

    // Action handler
    const executeAction = async (action, duration) => {
        if (!userId) { alert('Kullanıcı ID bulunamadı.'); return; }
        const channelSlug = state.chatControlActiveTab;
        if (!channelSlug) { alert('Aktif kanal yok.'); return; }

        try {
            const res = await apiFetch('/api/manual-mod', {
                method: 'POST',
                body: JSON.stringify({
                    action: action,
                    userId: userId,
                    duration: duration,
                    channelSlug: channelSlug,
                    reason: `Moderatör tarafından Kickky üzerinden (${action})`,
                    username: username
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'İşlem başarısız');
            }
            // Success feedback
            const actionsDiv = popup.querySelector('.user-history-actions');
            if (actionsDiv) {
                const label = action === 'ban' ? 'Banlandı' : `${duration}dk Timeout`;
                actionsDiv.innerHTML = `<div style="width:100%;text-align:center;padding:6px;color:var(--green);font-weight:700;font-size:0.95rem;">âœ… ${username} â†’ ${label}</div>`;
            }
            fetchLogs();
            fetchStats();
        } catch (err) {
            alert('İşlem başarısız: ' + err.message);
        }
    };

    // Timeout options
    popup.querySelectorAll('.uh-timeout-opt').forEach(opt => {
        opt.addEventListener('click', () => {
            const dur = parseInt(opt.dataset.dur);
            executeAction('timeout', dur);
        });
    });

    // Ban button
    banBtn.addEventListener('click', () => {
        if (confirm(`${username} kullanıcısını banlamak istediğinize emin misiniz?`)) {
            executeAction('ban', 0);
        }
    });
}

window.appendChatMessage = function(msgData) {
    if (!el.chatControlMessages) return;
    
    // Filter by active tab
    if (state.chatControlActiveTab !== msgData.channel) return;

    // Remove welcome message
    const welcome = el.chatControlMessages.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const msgEl = document.createElement('div');
    msgEl.className = 'kick-chat-msg';
    
    // Build badges
    let badgesHtml = '';
    if (msgData.message.sender && msgData.message.sender.identity && msgData.message.sender.identity.badges) {
        badgesHtml = '<span class="kick-chat-badges">';
        msgData.message.sender.identity.badges.forEach(b => {
            if (b.type === 'broadcaster') {
                badgesHtml += `<svg class="kick-badge" viewBox="0 0 24 24" fill="var(--red)" width="16" height="16" style="vertical-align:middle;margin-right:2px;"><path d="M12 2L2 22h20L12 2z"/></svg>`;
            } else if (b.type === 'moderator') {
                badgesHtml += `<svg class="kick-badge" viewBox="0 0 24 24" fill="var(--green)" width="16" height="16" style="vertical-align:middle;margin-right:2px;"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>`;
            } else if (b.type === 'subscriber') {
                badgesHtml += `<svg class="kick-badge" viewBox="0 0 24 24" fill="var(--purple)" width="16" height="16" style="vertical-align:middle;margin-right:2px;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
            } else if (b.type === 'sub_gifter') {
                badgesHtml += `<svg class="kick-badge" viewBox="0 0 24 24" fill="var(--orange)" stroke="currentColor" stroke-width="2" width="16" height="16" style="vertical-align:middle;margin-right:2px;"><polyline points="20 12 20 22 4 22 4 12"></polyline><rect x="2" y="7" width="20" height="5"></rect><line x1="12" y1="22" x2="12" y2="7"></line><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path></svg>`;
            } else {
                badgesHtml += `<span style="font-size: 0.7rem; background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px; margin-right: 2px; vertical-align: middle;">${b.type}</span>`;
            }
        });
        badgesHtml += '</span>';
    }

    let color = (msgData.message.sender && msgData.message.sender.identity && msgData.message.sender.identity.color) || '#53fc18';

    const rawContent = msgData.message.content || '';
    let parsedContent = parseKickEmotes(rawContent);

    const rawWatched = localStorage.getItem('chatWatchedWords') || '';
    let isMessageWatched = false;

    if (rawWatched.trim().length > 0) {
        const watchedWords = rawWatched.split(',')
            .map(w => w.replace(/[^\w\sğüşıöçÄÜÅİÖÇ]/gi, '').trim())
            .filter(w => w.length > 0);
            
        if (watchedWords.length > 0) {
            const escapedWords = watchedWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            const regex = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapedWords.join('|')})(?=[^\\p{L}\\p{N}]|$)`, 'gui');
            
            if (regex.test(parsedContent)) {
                isMessageWatched = true;
                parsedContent = parsedContent.replace(regex, '$1<span class="watched-word-highlight">$2</span>');
                msgEl.classList.add('has-watched-word');
            }
        }
    }

    const modActionsHtml = `
        <span class="quick-mod-actions">
            <button class="quick-mod-btn delete" data-action="delete" title="Sil">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15 4V3H9v1H4v2h1v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6h1V4h-5zm2 15H7V6h10v13z"></path><path d="M9 8h2v9H9zm4 0h2v9h-2z"></path></svg>
            </button>
            <div class="timeout-menu-wrapper">
                <button class="quick-mod-btn timeout" data-action="timeout" title="Zaman Aşımı (Varsayılan)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6v6l4.5 4.5L6 17v5h12v-5l-4.5-4.5L18 8V2zm-2 4v1.5l-2.5 2.5h-3L8 7.5V6h8zm-8 12v-1.5l2.5-2.5h3l2.5 2.5V18H8z"></path></svg>
                </button>
                <div class="timeout-popup">
                    <button class="timeout-popup-btn" data-action="timeout" data-duration="5">5m</button>
                    <button class="timeout-popup-btn" data-action="timeout" data-duration="10">10m</button>
                    <button class="timeout-popup-btn" data-action="timeout" data-duration="15">15m</button>
                    <button class="timeout-popup-btn" data-action="timeout" data-duration="30">30m</button>
                    <button class="timeout-popup-btn" data-action="timeout" data-duration="60">1h</button>
                    <button class="timeout-popup-btn" data-action="timeout" data-duration="1440">1g</button>
                    <button class="timeout-popup-btn" data-action="timeout" data-duration="10080">1hft</button>
                </div>
            </div>
            <button class="quick-mod-btn ban" data-action="ban" title="Banla">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L3 6v5.5c0 5.04 3.81 9.74 9 11.5 5.19-1.76 9-6.46 9-11.5V6l-9-4zm0 17c-4.14-1.51-7-5.58-7-9.5V7.4l7-3.11 7 3.11V11.5c0 3.92-2.86 7.99-7 9.5z"></path><path d="M14.59 8L8 14.59 9.41 16 16 9.41 14.59 8z"></path></svg>
            </button>
        </span>
    `;

    msgEl.innerHTML = `
        ${modActionsHtml}
        ${badgesHtml}
        <span class="kick-chat-username" style="color: ${color}; vertical-align: middle; margin-right: 6px; font-weight: 700; cursor: pointer;" data-username="${msgData.message.sender.username}" data-userid="${msgData.message.sender.id}">${msgData.message.sender.username}</span>
        <span class="kick-chat-content">${parsedContent}</span>
    `;

    // Store message in client-side buffer for user history
    if (!window._chatMessageBuffer) window._chatMessageBuffer = [];
    const msgId = msgData.message.id;
    // Check if message already exists in buffer to prevent duplicates
    if (!msgId || !window._chatMessageBuffer.find(m => m.id === msgId)) {
        window._chatMessageBuffer.push({
            id: msgId,
            channel: msgData.channel,
            username: msgData.message.sender.username,
            userId: msgData.message.sender.id,
            content: msgData.message.content || rawContent,
            timestamp: msgData.message.timestamp || new Date().toISOString(),
            color: color
        });
        if (window._chatMessageBuffer.length > 2000) {
            window._chatMessageBuffer = window._chatMessageBuffer.slice(-1500);
        }
    }

    // Username click â†’ show message history
    const usernameEl = msgEl.querySelector('.kick-chat-username');
    if (usernameEl) {
        usernameEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const clickedUser = usernameEl.dataset.username;
            showUserMessageHistory(clickedUser, color);
        });
    }

    // Interaction Listener
    msgEl.addEventListener('click', async (e) => {
        let action = 'none';
        let duration = localStorage.getItem('chatDefaultTimeout') || 5;

        // Quick Action logic
        const btn = e.target.closest('.quick-mod-btn') || e.target.closest('.timeout-popup-btn');
        if (btn) {
            action = btn.getAttribute('data-action');
            if (btn.classList.contains('timeout-popup-btn')) {
                duration = btn.getAttribute('data-duration');
            }
        } else {
            const deleteKey = (localStorage.getItem('chatKeyDelete') || 'shift').toLowerCase();
            const timeoutKey = (localStorage.getItem('chatKeyTimeout') || 'control').toLowerCase();
            const banKey = (localStorage.getItem('chatKeyBan') || 'alt').toLowerCase();

            if (banKey && pressedKeys.has(banKey)) action = 'ban';
            else if (timeoutKey && pressedKeys.has(timeoutKey)) action = 'timeout';
            else if (deleteKey && pressedKeys.has(deleteKey)) action = 'delete';
        }

        if (action === 'none') return;
        
        e.preventDefault();
        
        msgEl.classList.add('action-feedback');
        
        try {
            const res = await apiFetch('/api/manual-mod', {
                method: 'POST',
                body: JSON.stringify({
                    action: action,
                    userId: msgData.message.sender.id,
                    messageId: msgData.message.id,
                    duration: duration,
                    channelSlug: msgData.channel,
                    reason: 'Moderatör tarafından Kickky üzerinden',
                    username: msgData.message.sender.username,
                    messageContent: rawContent
                })
            });
            
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || 'İşlem sunucu tarafından reddedildi.');
            }
            
            fetchLogs();
            fetchStats();
            
            setTimeout(() => {
                if (action === 'delete') {
                    msgEl.style.display = 'none';
                } else if (action === 'unban') {
                    msgEl.style.opacity = '1';
                    const actionsContainer = msgEl.querySelector('.quick-mod-actions');
                    if (actionsContainer) {
                        actionsContainer.innerHTML = `
                            <button class="quick-mod-btn delete" data-action="delete" title="Sil">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M15 4V3H9v1H4v2h1v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6h1V4h-5zm2 15H7V6h10v13z"></path><path d="M9 8h2v9H9zm4 0h2v9h-2z"></path></svg>
                            </button>
                            <div class="timeout-menu-wrapper">
                                <button class="quick-mod-btn timeout" data-action="timeout" title="Zaman Aşımı (Varsayılan)">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2H6v6l4.5 4.5L6 17v5h12v-5l-4.5-4.5L18 8V2zm-2 4v1.5l-2.5 2.5h-3L8 7.5V6h8zm-8 12v-1.5l2.5-2.5h3l2.5 2.5V18H8z"></path></svg>
                                </button>
                                <div class="timeout-popup">
                                    <button class="timeout-popup-btn" data-action="timeout" data-duration="5">5m</button>
                                    <button class="timeout-popup-btn" data-action="timeout" data-duration="10">10m</button>
                                    <button class="timeout-popup-btn" data-action="timeout" data-duration="15">15m</button>
                                    <button class="timeout-popup-btn" data-action="timeout" data-duration="30">30m</button>
                                    <button class="timeout-popup-btn" data-action="timeout" data-duration="60">1h</button>
                                    <button class="timeout-popup-btn" data-action="timeout" data-duration="1440">1g</button>
                                    <button class="timeout-popup-btn" data-action="timeout" data-duration="10080">1hft</button>
                                </div>
                            </div>
                            <button class="quick-mod-btn ban" data-action="ban" title="Banla">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L3 6v5.5c0 5.04 3.81 9.74 9 11.5 5.19-1.76 9-6.46 9-11.5V6l-9-4zm0 17c-4.14-1.51-7-5.58-7-9.5V7.4l7-3.11 7 3.11V11.5c0 3.92-2.86 7.99-7 9.5z"></path><path d="M14.59 8L8 14.59 9.41 16 16 9.41 14.59 8z"></path></svg>
                            </button>
                        `;
                    }
                } else {
                    msgEl.style.opacity = '0.5';
                    const actionsContainer = msgEl.querySelector('.quick-mod-actions');
                    if (actionsContainer) {
                        actionsContainer.innerHTML = `
                            <button class="quick-mod-btn unban" data-action="unban" title="Yasağı Kaldır" style="color: var(--green);">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"></path></svg>
                            </button>
                        `;
                    }
                }
            }, 500);
        } catch (err) {
            msgEl.classList.remove('action-feedback');
            alert('İşlem başarısız oldu: ' + err.message);
        }
    });

    // Add Hover to pause logic on mod buttons
    const quickModBtns = msgEl.querySelectorAll('.quick-mod-btn.timeout, .quick-mod-btn.ban, .timeout-popup');
    quickModBtns.forEach(btn => {
        btn.addEventListener('mouseenter', () => {
            window._chatIsPaused = true;
            document.getElementById('resumeChatOverlay').style.display = 'block';
        });
        btn.addEventListener('mouseleave', () => {
            // We do not auto-resume on mouseleave if they scrolled up, 
            // but we can just leave it paused and let them click "Canlı sohbete dön".
        });
    });

    const isScrolledToBottom = Math.abs((el.chatContainer.scrollHeight - el.chatContainer.clientHeight) - el.chatContainer.scrollTop) < 50;

    el.chatControlMessages.appendChild(msgEl);
    
    // Auto-scroll logic considering pause state
    if (!window._chatIsPaused && (isScrolledToBottom || el.chatControlMessages.children.length === 1)) {
        el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
        document.getElementById('resumeChatOverlay').style.display = 'none';
    } else {
        // If chat receives messages while not at bottom, show the overlay
        if (el.chatControlMessages.children.length > 1) {
            document.getElementById('resumeChatOverlay').style.display = 'block';
            window._chatIsPaused = true;
        }
    }

    // Prune DOM (Max 500 messages)
    while (el.chatControlMessages.children.length > 500) {
        el.chatControlMessages.removeChild(el.chatControlMessages.firstChild);
    }
};

// Handle manual scroll to detect when user scrolls up
el.chatContainer?.addEventListener('scroll', () => {
    const isScrolledToBottom = Math.abs((el.chatContainer.scrollHeight - el.chatContainer.clientHeight) - el.chatContainer.scrollTop) < 50;
    if (!isScrolledToBottom) {
        window._chatIsPaused = true;
        document.getElementById('resumeChatOverlay').style.display = 'block';
    } else {
        window._chatIsPaused = false;
        document.getElementById('resumeChatOverlay').style.display = 'none';
    }
});

// Resume chat button listener
document.getElementById('resumeChatBtn')?.addEventListener('click', () => {
    window._chatIsPaused = false;
    document.getElementById('resumeChatOverlay').style.display = 'none';
    el.chatContainer.scrollTop = el.chatContainer.scrollHeight;
});

// ===== Cross Ban Logic =====
async function fetchCrossBanChannels() {
    const tbody = document.getElementById('cbChannelsBody');
    if (!tbody) return;
    try {
        const res = await apiFetch('/api/crossban/channels');
        if (!res.ok) return;
        const channels = await res.json();
        
        if (channels.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 1rem; color: var(--text-3);">Henüz kanal eklenmedi.</td></tr>`;
            return;
        }

        tbody.innerHTML = channels.map(ch => `
            <tr>
                <td style="font-weight: 600;">${ch.slug}</td>
                <td style="color: var(--text-2); font-family: monospace;">${ch.broadcasterUserId || ch.chatroomId}</td>
                <td>
                    <button class="action-btn reject" onclick="deleteCrossBanChannel('${ch._id}')" title="Sil">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </td>
            </tr>
        `).join('');
    } catch (e) { console.error('Fetch cross ban channels failed:', e); }
}

async function fetchCrossBanLogs() {
    const tbody = document.getElementById('cbLogsBody');
    if (!tbody) return;
    try {
        const res = await apiFetch('/api/crossban/logs');
        if (!res.ok) return;
        const logs = await res.json();
        
        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 1rem; color: var(--text-3);">Geçmiş temiz.</td></tr>`;
            return;
        }

        tbody.innerHTML = logs.map(l => {
            let actionBadge = '';
            if (l.action === 'ban') actionBadge = '<span style="color:var(--red); font-weight:700; font-size:0.75rem; background:rgba(239,68,68,0.1); padding:4px 8px; border-radius:4px;">BAN</span>';
            else if (l.action === 'timeout') actionBadge = `<span style="color:var(--orange); font-weight:700; font-size:0.75rem; background:rgba(245,158,11,0.1); padding:4px 8px; border-radius:4px;">TIMEOUT (${l.duration}m)</span>`;
            else if (l.action === 'unban') actionBadge = '<span style="color:var(--green); font-weight:700; font-size:0.75rem; background:rgba(34,197,94,0.1); padding:4px 8px; border-radius:4px;">UNBAN</span>';

            const imgHtml = l.imageUrl ? `<a href="${l.imageUrl}" target="_blank" style="color: var(--primary); text-decoration: underline; font-size: 0.8rem;">Görseli Gör</a>` : '-';
            
            return `
            <tr>
                <td style="color: var(--text-3); font-size: 0.85rem;">${new Date(l.createdAt).toLocaleString('tr-TR')}</td>
                <td style="font-weight: 600;">${l.username}</td>
                <td>${actionBadge}</td>
                <td style="color: var(--text-2); max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${l.reason || ''}">${l.reason || '-'}</td>
                <td>${imgHtml}</td>
            </tr>
            `;
        }).join('');
    } catch (e) { console.error('Fetch cross ban logs failed:', e); }
}

window.deleteCrossBanChannel = async function(id) {
    if (!confirm('Bu kanalı cross ban listesinden çıkarmak istediğinize emin misiniz?')) return;
    try {
        await apiFetch(`/api/crossban/channels/${id}`, { method: 'DELETE' });
        fetchCrossBanChannels();
    } catch(e) {}
};

document.getElementById('cbAddChannelBtn')?.addEventListener('click', async () => {
    const slug = prompt('Eklenecek kanalın adını (slug) girin:');
    if (!slug) return;
    try {
        const res = await apiFetch('/api/crossban/channels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug })
        });
        if (res.ok) fetchCrossBanChannels();
        else {
            const data = await res.json();
            alert(data.error || 'Kanal eklenemedi.');
        }
    } catch (e) { alert('Hata oluştu.'); }
});

document.getElementById('cbAction')?.addEventListener('change', (e) => {
    const durCont = document.getElementById('cbDurationContainer');
    if (e.target.value === 'timeout') durCont.style.display = 'block';
    else durCont.style.display = 'none';
});

document.getElementById('crossBanForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!confirm('Seçtiğiniz işlemi tüm kanallarda başlatmak istediğinize emin misiniz? Bu işlem geri alınamaz!')) return;

    const btn = document.getElementById('cbExecuteBtn');
    btn.disabled = true;
    btn.innerHTML = 'İşleniyor...';

    const formData = new FormData();
    formData.append('username', document.getElementById('cbUsername').value);
    formData.append('action', document.getElementById('cbAction').value);
    formData.append('reason', document.getElementById('cbReason').value);
    
    if (document.getElementById('cbAction').value === 'timeout') {
        formData.append('duration', document.getElementById('cbDuration').value);
    }
    
    const imageFile = document.getElementById('cbImage').files[0];
    if (imageFile) formData.append('image', imageFile);

    try {
        const csrfRes = await fetch('/api/csrf-token');
        const csrfData = await csrfRes.json();
        
        const res = await fetch('/api/crossban/action', {
            method: 'POST',
            headers: { 'CSRF-Token': csrfData.csrfToken },
            body: formData // FormData does not need Content-Type, browser sets it with boundary
        });

        if (res.ok) {
            document.getElementById('cbUsername').value = '';
            document.getElementById('cbReason').value = '';
            document.getElementById('cbImage').value = '';
            fetchCrossBanLogs();
            alert('İşlem başarıyla başlatıldı ve arka planda tüm kanallara uygulanıyor.');
        } else {
            const data = await res.json();
            alert(data.error || 'İşlem başarısız oldu.');
        }
    } catch (err) {
        alert('Sunucu hatası.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'ATEŞLE (ÇALIŞTIR)';
    }
});

// ===== Boot =====
document.addEventListener('DOMContentLoaded', initApp);

