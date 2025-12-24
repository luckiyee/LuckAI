/* ========================================
   CHAT MANAGER - Main Chat Interface
   ======================================== */

class ChatManager {
    constructor() {
        // DOM Elements
        this.messagesContainer = document.getElementById('messagesContainer');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.menuToggle = document.getElementById('menuToggle');
        this.sidebar = document.getElementById('sidebar');
        this.sidebarOverlay = document.getElementById('sidebarOverlay');
        this.closeSidebar = document.getElementById('closeSidebar');
        this.webToggle = document.getElementById('webToggle');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.inputStatus = document.getElementById('inputStatus');

        // State
        this.conversationHistory = [];
        this.isLoading = false;
        this.webSearchEnabled = true;
        this.isGuest = localStorage.getItem('guestMode') === 'true';

        // Internal runtime flags
        this._activeTypingIndicators = new Set(); // track active typing indicator ids
        this.debug = !!(window.LUCKAI_DEBUG); // enable optional debug logging when set globally

        // Initialize
        this.init();
    }

    async init() {
        // Check authentication
        if (!this.isGuest && !apiClient.isAuthenticated()) {
            this.redirectToLogin();
            return;
        }

        // Setup event listeners
        this.setupEventListeners();

        // Restore preferences and history
        this.restoreWebSearchPreference();
        if (!this.isGuest) {
            this.restoreHistory();
        } else {
            // In guest mode, clear any previous history
            this.conversationHistory = [];
            localStorage.removeItem('luckai_history');
        }
    }

    setupEventListeners() {
        // Send message
        this.sendBtn?.addEventListener('click', () => this.sendMessage());

        // Enter key
        this.messageInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Auto-resize textarea
        this.messageInput?.addEventListener('input', () => {
            this.messageInput.style.height = 'auto';
            this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 150) + 'px';
        });

        // Mode buttons (Search / Local)
        this.searchModeBtn = document.getElementById('searchModeBtn');
        this.localModeBtn = document.getElementById('localModeBtn');
        if (this.searchModeBtn && this.localModeBtn) {
            this.setupModeButtons();
        }

        // Reset history button
        const resetHistoryBtn = document.getElementById('resetHistoryBtn');
        if (resetHistoryBtn) {
            resetHistoryBtn.addEventListener('click', () => this.resetHistory());
        }



        // Logout
        this.logoutBtn?.addEventListener('click', () => this.logout());

        // Sidebar toggle (if exists)
        if (this.menuToggle && this.sidebarOverlay && this.closeSidebar) {
            this.menuToggle.addEventListener('click', () => {
                this.toggleSidebar();
            });

            this.sidebarOverlay.addEventListener('click', () => {
                this.closeSidebarMenu();
            });

            this.closeSidebar.addEventListener('click', () => {
                this.closeSidebarMenu();
            });

            // Sidebar links click (for mobile)
            document.querySelectorAll('.sidebar-link').forEach(link => {
                link.addEventListener('click', () => {
                    if (window.innerWidth < 768) {
                        this.closeSidebarMenu();
                    }
                });
            });
        }
    }

    toggleSidebar() {
        if (!this.sidebar || !this.sidebarOverlay || !this.menuToggle) return;
        this.sidebar.classList.toggle('hidden');
        this.sidebarOverlay.classList.toggle('show');
        this.menuToggle.classList.toggle('active');
    }

    setupModeButtons() {
        // Localize button labels
        const isFR = (document.documentElement.lang || '').startsWith('fr');
        if (isFR) {
            this.searchModeBtn.textContent = '🔎 Recherche';
            this.localModeBtn.textContent = '⌘ Local';
        } else {
            this.searchModeBtn.textContent = '🔎 Search';
            this.localModeBtn.textContent = '⌘ Local';
        }

        // Initialize UI state
        this.updateModeUI();

        this.searchModeBtn.addEventListener('click', () => {
            this.webSearchEnabled = true;
            localStorage.setItem('luckai_websearch', this.webSearchEnabled);
            this.updateModeUI();
        });

        this.localModeBtn.addEventListener('click', () => {
            this.webSearchEnabled = false;
            localStorage.setItem('luckai_websearch', this.webSearchEnabled);
            this.updateModeUI();
        });
    }

    updateModeUI() {
        if (!this.searchModeBtn || !this.localModeBtn) return;
        if (this.webSearchEnabled) {
            this.searchModeBtn.classList.add('active');
            this.searchModeBtn.setAttribute('aria-pressed', 'true');
            this.localModeBtn.classList.remove('active');
            this.localModeBtn.setAttribute('aria-pressed', 'false');
        } else {
            this.searchModeBtn.classList.remove('active');
            this.searchModeBtn.setAttribute('aria-pressed', 'false');
            this.localModeBtn.classList.add('active');
            this.localModeBtn.setAttribute('aria-pressed', 'true');
        }
    }

    closeSidebarMenu() {
        if (!this.sidebar || !this.sidebarOverlay || !this.menuToggle) return;
        this.sidebar.classList.add('hidden');
        this.sidebarOverlay.classList.remove('show');
        this.menuToggle.classList.remove('active');
    }

    restoreWebSearchPreference() {
        const saved = localStorage.getItem('luckai_websearch');
        this.webSearchEnabled = saved !== 'false';
        // Initialize mode buttons UI if present
        if (this.searchModeBtn && this.localModeBtn) {
            this.updateModeUI();
        }
    }

    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || this.isLoading) return;

        // Clear input
        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';

        // Add user message
        this.addMessage(message, 'user');
        this.conversationHistory.push({ role: 'user', content: message });

        // Show loading
        this.isLoading = true;
        this.sendBtn.disabled = true;
        this.messageInput.disabled = true;
        this.inputStatus.textContent = 'LuckAI is thinking...';

        const typingId = this.showTypingIndicator();

        try {
            // Mode: 'always' forces web search for all queries, 'never' disables it
            const searchMode = this.webSearchEnabled ? 'always' : 'never';
            const response = await apiClient.sendMessage(
                message,
                this.conversationHistory,
                searchMode,
                { fast: true, maxTokens: 96 }
            );

            // Surface search errors from the server to the UI briefly
            if (response && response.searchError) {
                this.inputStatus.textContent = response.searchError;
                setTimeout(() => {
                    if (this.inputStatus && this.inputStatus.textContent === response.searchError) this.inputStatus.textContent = '';
                }, 6000);
            }

            // Keep a short, realistic typing pause before showing the final message
            const estimatedDelay = Math.min(1200 + Math.floor((response.answer || '').length / 40) * 40, 1800);
            await new Promise(r => setTimeout(r, estimatedDelay));

            // Optionally show search provider used
            if (response && response.searchProvider) {
                const providerLabel = (document.documentElement.lang.startsWith('fr') ? 'DuckDuckGo (Web)' : 'DuckDuckGo (Web)');
                this.inputStatus.textContent = providerLabel;
                setTimeout(() => { if (this.inputStatus && this.inputStatus.textContent === providerLabel) this.inputStatus.textContent = ''; }, 3000);
            }

            // Insert an empty AI message element
            const aiMessage = this.addMessage('', 'ai', response.sources, response.usedWeb, { prompt: message });

            // Animate short or full depending on whether a full response will be available
            if (response.pendingFull && response.fullId) {
                // Show short answer quickly (chunk mode), keep global typing indicator visible while full is generated
                this.animateAIResponse(aiMessage, response.answer, { mode: 'chunk' });
            } else {
                // Single-phase response: animate word-by-word and remove global typing indicator when done
                try {
                    await this.animateAIResponse(aiMessage, response.answer, { mode: 'word' });
                } catch (e) {
                    // ignore
                }
                try { if (typingId) this.removeTypingIndicator(typingId); } catch (e) {}
            }

            this.setRetryTarget(aiMessage);

            // Save short response to history immediately
            this.conversationHistory.push({ role: 'assistant', content: response.answer });
            this.persistHistory();

            // If a full response is pending, poll for it and replace the message when ready
            if (response.pendingFull && response.fullId) {
                const fullId = response.fullId;
                // Show inline typing indicator while full answer is generating
                let inlineTypingId = null;
                try { inlineTypingId = this.showInlineTypingIndicator(aiMessage); } catch (e) { inlineTypingId = null; }

                const poll = async (attempt = 0) => {
                    const r = await apiClient.fetchFullAnswer(fullId);
                    if (r.ready) {
                        const fullText = r.answer || r.error || response.answer;
                        // Remove inline typing indicator if present
                        try { if (inlineTypingId) this.removeTypingIndicator(inlineTypingId); } catch (e) {}

                        // Remove global typing indicator (server finished processing)
                        try { if (typingId) this.removeTypingIndicator(typingId); } catch (e) {}

                        // Before animating, run a quick fix pass to replace broken favicons in this message
                        try { this.fixBrokenFaviconsInNode(aiMessage); } catch (e) {}

                        // Animate the final full text into the message (word-by-word for realism)
                        try { await this.animateAIResponse(aiMessage, fullText, { mode: 'word' }); } catch (e) {
                            // Fallback to direct insertion if animation fails
                            const contentDiv = aiMessage.querySelector('.message-content');
                            if (contentDiv) {
                                try {
                                    if (typeof marked !== 'undefined') contentDiv.innerHTML = marked.parse(fullText);
                                    else contentDiv.textContent = fullText;
                                } catch (err) { contentDiv.textContent = fullText; }
                                this.highlightBlocks(aiMessage);
                            }
                        }

                        // Update local conversation history last assistant entry
                        for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
                            if (this.conversationHistory[i].role === 'assistant') {
                                this.conversationHistory[i].content = fullText;
                                break;
                            }
                        }
                        this.persistHistory();
                        return;
                    }
                    // Backoff polling: 1s, 1s, 2s, 3s, 5s
                    const delays = [1000, 1000, 2000, 3000, 5000];
                    const delay = delays[Math.min(attempt, delays.length - 1)];
                    setTimeout(() => poll(attempt + 1), delay);
                };
                poll();
            }

        } catch (error) {
            console.error('Chat error:', error);
            this.removeTypingIndicator(typingId);
            this.addMessage(`Error: ${error.message || 'Failed to get response from LuckAI'}`, 'ai');
            this.inputStatus.textContent = error.message || 'Error sending message';
        } finally {
            this.isLoading = false;
            this.sendBtn.disabled = false;
            this.messageInput.disabled = false;
            this.inputStatus.textContent = '';
            this.messageInput.focus();
        }
    }

    addMessage(content, role, sources = null, usedWeb = false, meta = {}) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        // Ensure each message has a stable id for feedback tracking
        if (!messageDiv.id) messageDiv.id = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
        messageDiv.dataset.id = messageDiv.id;
        messageDiv.dataset.role = role;
        if (meta.prompt) messageDiv.dataset.prompt = meta.prompt;

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        this.renderMessageContent(contentDiv, role, content);
        messageDiv.appendChild(contentDiv);

        // Sources display is disabled by user preference — do not append inline citations or source pills
        // (sources still received server-side but intentionally not shown in the UI)

        if (role === 'ai') {
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'message-actions';

            const labels = this.getLocaleLabels();

            const copyBtn = document.createElement('button');
            copyBtn.className = 'icon-btn copy-btn';
            copyBtn.title = labels.copy;
            copyBtn.setAttribute('aria-label', labels.copy);
            // Use the requested Unicode glyph and still show a textual tooltip
            copyBtn.textContent = '🗐';
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(contentDiv.innerText);
                    // temporarily show confirmation (keeps glyph but sets title briefly)
                    const orig = copyBtn.title;
                    copyBtn.title = labels.copied;
                    setTimeout(() => { copyBtn.title = orig; }, 1200);
                } catch {}
            });
            actionsDiv.appendChild(copyBtn);

            // Feedback buttons (thumbs up / thumbs down)
            const upBtn = document.createElement('button');
            upBtn.className = 'icon-btn feedback-btn up';
            upBtn.title = (document.documentElement.lang.startsWith('fr') ? "J'aime" : 'Like');
            upBtn.setAttribute('aria-label', upBtn.title);
            upBtn.textContent = '👍';
            upBtn.addEventListener('click', async () => {
                try {
                    const contentText = contentDiv.innerText || contentDiv.textContent || '';
                    const msgId = messageDiv.dataset.id || messageDiv.id || '';
                    await apiClient.sendFeedback(msgId, 'up', contentText, messageDiv.dataset.prompt || '');
                    upBtn.classList.add('active');
                    upBtn.setAttribute('aria-pressed', 'true');
                    upBtn.disabled = true;
                    if (downBtn) { downBtn.disabled = true; downBtn.classList.remove('active'); downBtn.setAttribute('aria-pressed', 'false'); }
                    // brief confirmation
                    const orig = upBtn.title;
                    upBtn.title = (document.documentElement.lang.startsWith('fr') ? 'Merci' : 'Thanks');
                    try { this.inputStatus.textContent = (document.documentElement.lang.startsWith('fr') ? 'Merci pour votre retour' : 'Thanks for your feedback'); } catch (e) {}
                    setTimeout(() => { try { upBtn.title = orig; if (this.inputStatus && this.inputStatus.textContent) this.inputStatus.textContent = ''; } catch (e) {} }, 1400);
                } catch (e) {
                    console.error('Feedback send failed:', e);
                    try { this.inputStatus.textContent = (document.documentElement.lang.startsWith('fr') ? 'Échec du retour' : 'Feedback failed'); } catch (e) {}
                    setTimeout(() => { try { if (this.inputStatus && this.inputStatus.textContent) this.inputStatus.textContent = ''; } catch (e) {} }, 1600);
                }
            });
            actionsDiv.appendChild(upBtn);

            const downBtn = document.createElement('button');
            downBtn.className = 'icon-btn feedback-btn down';
            downBtn.title = (document.documentElement.lang.startsWith('fr') ? 'Je n\u2019aime pas' : 'Dislike');
            downBtn.setAttribute('aria-label', downBtn.title);
            downBtn.textContent = '👎';
            downBtn.addEventListener('click', async () => {
                try {
                    const contentText = contentDiv.innerText || contentDiv.textContent || '';
                    const msgId = messageDiv.dataset.id || messageDiv.id || '';
                    await apiClient.sendFeedback(msgId, 'down', contentText, messageDiv.dataset.prompt || '');
                    downBtn.classList.add('active');
                    downBtn.setAttribute('aria-pressed', 'true');
                    downBtn.disabled = true;
                    if (upBtn) { upBtn.disabled = true; upBtn.classList.remove('active'); upBtn.setAttribute('aria-pressed', 'false'); }
                    const orig = downBtn.title;
                    downBtn.title = (document.documentElement.lang.startsWith('fr') ? 'Merci pour le retour' : 'Thanks for the feedback');
                    try { this.inputStatus.textContent = (document.documentElement.lang.startsWith('fr') ? 'Merci pour votre retour' : 'Thanks for your feedback'); } catch (e) {}
                    setTimeout(() => { try { downBtn.title = orig; if (this.inputStatus && this.inputStatus.textContent) this.inputStatus.textContent = ''; } catch (e) {} }, 1400);
                } catch (e) {
                    console.error('Feedback send failed:', e);
                    try { this.inputStatus.textContent = (document.documentElement.lang.startsWith('fr') ? 'Échec du retour' : 'Feedback failed'); } catch (e) {}
                    setTimeout(() => { try { if (this.inputStatus && this.inputStatus.textContent) this.inputStatus.textContent = ''; } catch (e) {} }, 1600);
                }
            });
            actionsDiv.appendChild(downBtn);

            if (meta.prompt) {
                const retryBtn = document.createElement('button');
                retryBtn.className = 'icon-btn retry-btn';
                retryBtn.title = labels.retry;
                retryBtn.setAttribute('aria-label', labels.retry);
                retryBtn.textContent = '⟳';
                retryBtn.addEventListener('click', () => this.retryMessage(messageDiv));
                actionsDiv.appendChild(retryBtn);
            }

            messageDiv.appendChild(actionsDiv);
        }

        this.messagesContainer.appendChild(messageDiv);
        this.highlightBlocks(messageDiv);
        this.scrollToBottom();

        // Purge any legacy source blocks if present (fix inconsistent old-format insertions)
        try { this.purgeLegacySourceNodes(); } catch (e) { /* ignore */ }
        // Ensure any legacy inline pills are upgraded to show icons and concise count
        try { this.updateLegacyInlineSources(); } catch (e) { /* ignore */ }

        return messageDiv;
    }

    sanitizeContent(content) {
        if (!content) return content;
        const lines = String(content).split(/\r?\n/);
        const filtered = lines.filter(line => {
            const t = String(line || '').trim();
            if (!t) return true;
            if (/duckduckgo\.com\/l\//i.test(t)) return false;
            if (/\buddg=/i.test(t)) return false;
            if (/^https?:\/\//i.test(t) || /^\/\//.test(t)) return false;
            if (/(%3A|%2F|%3D|%26|%3F)/i.test(t) && t.length > 24) return false;
            if (/[\/%=\?&]/.test(t) && t.length > 40) return false;
            return true;
        });
        return filtered.join('\n').trim();
    }

    renderMessageContent(target, role, content) {
        if (role === 'ai' && typeof marked !== 'undefined') {
            const safe = this.sanitizeContent(content || '');
            target.innerHTML = marked.parse(safe || '');
            // Remove any trailing empty paragraphs or whitespace nodes that can create extra space
            this.cleanupTrailingEmptyBlocks(target);
        } else {
            target.textContent = content;
        }
    }

    // Remove trailing empty text nodes or elements (like empty <p> or <br>) that add an extra gap at the bottom
    cleanupTrailingEmptyBlocks(target) {
        while (target.lastChild) {
            const node = target.lastChild;
            if (node.nodeType === Node.TEXT_NODE) {
                if (!node.textContent.trim()) {
                    target.removeChild(node);
                    continue;
                }
                break;
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node;
                const tag = el.tagName.toLowerCase();
                // Remove empty paragraphs, divs or lone <br>
                if ((tag === 'p' || tag === 'div' || tag === 'br') && !el.textContent.trim()) {
                    target.removeChild(node);
                    continue;
                }
                // If element contains only whitespace/empty children (and no meaningful content), remove it
                if (!el.textContent.trim() && !el.querySelector('img, code, pre, a, ul, ol, li')) {
                    target.removeChild(node);
                    continue;
                }
                break;
            }
            break;
        }
    }

    // Inline pill-style sources display (compact: favicon cluster + "N sources")
    buildSourcesInline(sources) {
        const wrap = document.createElement('div');
        wrap.className = 'message-sources-inline sources-pill-wrap';
        if (!sources || sources.length === 0) return wrap;

        let idx = 0;
        const pill = document.createElement('div');
        pill.className = 'sources-pill';
        pill.addEventListener('click', () => this.showSourcesPanel(sources));

        // small favicon cluster on the left (overlapping circular icons)
        const miniWrap = document.createElement('div');
        miniWrap.className = 'source-mini-wrap';
        // Prevent mini icons from absorbing clicks — let the pill handle them
        miniWrap.style.pointerEvents = 'none';

        sources.slice(0, 3).forEach(s => {
            let h = '';
            try { h = s.host || (new URL(s.url).hostname.replace(/^www\./, '')); } catch (e) { h = ''; }
            this.appendFaviconTo(miniWrap, h, s.title || s.url, { className: 'source-mini source-mini-inline', placeholderClass: 'source-mini-placeholder', extraInlineClass: 'source-mini-inline' });
        });
        pill.appendChild(miniWrap);

        // Make the entire wrap clickable (not just sub-elements) and ensure clicks open the panel
        wrap.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); this.showSourcesPanel(sources); });
        // Make cursor indicate clickability
        pill.style.cursor = 'pointer';

        // Compact label (e.g. "20 sources") — when multiple sources, show count; for single, show title/url
        const pillUrl = document.createElement('div');
        pillUrl.className = 'pill-url pill-label';
        pill.appendChild(pillUrl);

        const showIndex = (i) => {
            idx = ((i % sources.length) + sources.length) % sources.length;
            if (sources.length > 1) {
                // Show the full "N sources" text inside the pill (matches requested design)
                pillUrl.textContent = `${sources.length} sources`;
                pillUrl.title = `${sources.length} sources`;
            } else {
                const s = sources[0];
                const displayText = (s && s.title) ? s.title : ((s && s.url) ? s.url : '');
                pillUrl.textContent = displayText;
                pillUrl.title = displayText;
            }
        };

        // Right-most compact numeric badge that also opens the panel (only shows the number to avoid duplicate text)
        const count = document.createElement('button');
        count.className = 'sources-count-green sources-count-compact';
        count.textContent = `${sources.length}`;
        count.title = `${sources.length} sources`;
        count.addEventListener('click', (e) => { e.stopPropagation(); this.showSourcesPanel(sources); });
        count.style.cursor = 'pointer';

        // Append pill to wrapper and count to the right
        wrap.appendChild(pill);
        wrap.appendChild(count);

        // Make label reflect initial state
        showIndex(0);

        return wrap;
    }


    highlightBlocks(messageDiv) {
        if (typeof hljs !== 'undefined') {
            messageDiv.querySelectorAll('pre code').forEach((el) => hljs.highlightElement(el));
        }
        this.enrichCodeBlocks(messageDiv);
    }

    // Small inline citation chips (host + optional +N)
    buildInlineCitations(sources) {
        if (!sources || !sources.length) return null;
        // Group by host
        const counts = {};
        sources.forEach(s => {
            const h = s.host || ((s.url && (() => { try { return (new URL(s.url)).hostname.replace(/^www\./, ''); } catch (e) { return s.url || ''; } })())) || 'unknown';
            counts[h] = (counts[h] || 0) + 1;
        });
        const keys = Object.keys(counts).slice(0, 4);
        const wrap = document.createElement('div');
        wrap.className = 'inline-citations';
        keys.forEach(k => {
            const c = document.createElement('button');
            c.className = 'inline-citation';
            c.textContent = k + (counts[k] > 1 ? ` +${counts[k]-1}` : '');
            c.title = `${counts[k]} source(s) from ${k}`;
            c.addEventListener('click', () => this.showSourcesPanel(sources.filter(s => (s.host || (new URL(s.url).hostname.replace(/^www\./, ''))) === k)));
            wrap.appendChild(c);
        });
        return wrap;
    }

    // Show a modal/panel listing all sources with cards (favicon, title, snippet, domain)
    showSourcesPanel(sources) {
        // Sources display is disabled by user preference. No panel will be shown.
        try {
            const note = document.createElement('div');
            note.className = 'notification info';
            note.textContent = document.documentElement.lang && document.documentElement.lang.startsWith('fr') ? "Les sources sont masquées" : 'Sources are hidden';
            note.style.cssText = `position: fixed; top: 18px; right: 18px; background: rgba(255,255,255,0.05); color: var(--text-primary); padding: 10px 14px; border-radius: 6px; z-index: 10001;`;
            document.body.appendChild(note);
            setTimeout(() => { note.style.transition = 'opacity 0.3s'; note.style.opacity = '0'; setTimeout(() => note.remove(), 300); }, 1600);
        } catch (e) { /* no-op */ }
        return;
        // helper: resolve DuckDuckGo redirect (uddg) to original target when present
        const resolveTarget = (rawUrl) => {
            if (!rawUrl) return rawUrl;
            try {
                // Some s.url values are already full urls, some begin with //
                const u = new URL(rawUrl, window.location.origin);
                const params = new URLSearchParams(u.search);
                if (params.has('uddg')) {
                    let v = params.get('uddg') || '';
                    v = v.replace(/&amp;/g, '&');
                    try { return decodeURIComponent(v); } catch (e) { return v; }
                }
                // fallback: find uddg= in raw string
                const m = rawUrl.match(/uddg=([^&]+)/i);
                if (m && m[1]) {
                    try { return decodeURIComponent(m[1].replace(/&amp;/g, '&')); } catch (e) { return m[1]; }
                }
                return rawUrl;
            } catch (e) {
                const m = String(rawUrl).match(/uddg=([^&]+)/i);
                if (m && m[1]) {
                    try { return decodeURIComponent(m[1].replace(/&amp;/g, '&')); } catch (e) { return m[1]; }
                }
                return rawUrl;
            }
        };

        sources.forEach(s => {
            const item = document.createElement('a');
            item.className = 'sources-panel__item';

            const target = resolveTarget(s.url || '');
            item.href = target || (s.url || '#');
            item.target = '_blank';

            const h = s.host || (() => { try { return (new URL(target || (s.url || ''), window.location.origin)).hostname.replace(/^www\./, ''); } catch (e) { return ''; } })();

            // Use robust favicon loader that falls back and replaces broken icons
            this.appendFaviconTo(item, h, s.title || s.url, { className: 'sp-favicon', placeholderClass: 'sp-favicon-placeholder', extraInlineClass: '' });


            const body = document.createElement('div');
            body.className = 'sp-body';

            const t = document.createElement('div');
            t.className = 'sp-title';
            t.textContent = s.title || target || s.url || '';

            const snippet = document.createElement('div');
            snippet.className = 'sp-snippet';
            // sanitize snippet to avoid showing raw uddg or encoded lines
            snippet.textContent = this.sanitizeContent(s.snippet || '') || '';

            const urlMeta = document.createElement('div');
            urlMeta.className = 'sp-url';
            try {
                urlMeta.textContent = (new URL(target || (s.url || ''), window.location.origin)).hostname.replace(/^www\./, '') || ''; 
            } catch (e) {
                urlMeta.textContent = s.host || (s.url || '');
            }

            body.appendChild(t);
            if (snippet && snippet.textContent) body.appendChild(snippet);
            body.appendChild(urlMeta);

            // Append favicon if it exists and wasn't removed; otherwise ensure placeholder exists
            if (fav && fav.src && fav.src.trim()) {
                if (!item.contains(fav)) item.insertBefore(fav, body);
            } else {
                if (!item.querySelector('.sp-favicon-placeholder')) {
                    const ph = document.createElement('div');
                    ph.className = 'sp-favicon-placeholder';
                    ph.textContent = (h && h[0]) ? h[0].toUpperCase() : '?';
                    item.insertBefore(ph, body);
                }
            }

            item.appendChild(body);

            list.appendChild(item);
        });

        // Footer with copy and retry
        const footer = document.createElement('div');
        footer.className = 'sources-panel__footer';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'mode-btn copy-panel-btn';
        copyBtn.title = 'Copy sources';
        copyBtn.setAttribute('aria-label', 'Copy sources');
        copyBtn.textContent = '🗐';
        copyBtn.addEventListener('click', async () => {
            const text = sources.map(s => (s.url && s.url.includes('uddg=')) ? (function(){ try{ const m = (s.url.match(/uddg=([^&]+)/i)||[])[1]; return m ? decodeURIComponent(m.replace(/&amp;/g,'&')) : s.url }catch(e){return s.url}})() : (s.url||s.title||'')).join('\n\n');
            try { await navigator.clipboard.writeText(text); const orig = copyBtn.title; copyBtn.title = 'Copied'; setTimeout(()=>copyBtn.title = orig, 2000); } catch(e) { const orig = copyBtn.title; copyBtn.title = 'Failed'; setTimeout(()=>copyBtn.title = orig, 2000); }
        });
        const retryBtn = document.createElement('button');
        retryBtn.className = 'mode-btn retry-panel-btn';
        retryBtn.title = 'Retry';
        retryBtn.setAttribute('aria-label', 'Retry');
        retryBtn.textContent = '⟳';
        retryBtn.addEventListener('click', () => {
            // trigger first enabled retry button in the chat UI
            const r = document.querySelector('.retry-btn:not([disabled])');
            if (r) r.click();
        });
        footer.appendChild(copyBtn);
        footer.appendChild(retryBtn);

        box.appendChild(header);
        box.appendChild(list);
        box.appendChild(footer);
        panel.appendChild(box);
        document.body.appendChild(panel);

        // Close on overlay click
        panel.addEventListener('click', (e) => {
            if (e.target === panel) panel.remove();
        });
    }

    // Animate AI response into the message bubble. Returns a Promise that resolves when final render is complete.
    animateAIResponse(messageElement, fullText, options = {}) {
        const mode = (options && options.mode) || 'chunk'; // 'chunk' or 'word'
        const contentDiv = messageElement.querySelector('.message-content');
        if (!contentDiv) return Promise.resolve();

        // Replace fenced code blocks with safe placeholders during incremental rendering
        // so partial markdown fragments (open fences) don't break the HTML parser.
        const codeBlocks = [];
        let safeText = fullText || '';
        // Replace complete fenced blocks first
        safeText = safeText.replace(/```[\s\S]*?```/g, (m) => {
            codeBlocks.push(m);
            return `__CODEBLOCK_${codeBlocks.length - 1}__`;
        });
        // If there's an unclosed fence at the end, replace that too
        if (/```/.test(safeText) && /```[\s\S]*```/.test(fullText) === false) {
            safeText = safeText.replace(/```[\s\S]*$/g, (m) => {
                codeBlocks.push(m);
                return `__CODEBLOCK_${codeBlocks.length - 1}__`;
            });
        }
        const placeholders = codeBlocks.map((b, i) => `[code block ${i + 1}]`);
        const displaySafeText = safeText.replace(/__CODEBLOCK_(\d+)__/g, (m, n) => placeholders[Number(n)] || '[code]');

        // Ensure we clear any prior timer state for this message
        try { if (messageElement._aiTypingTimer) { clearTimeout(messageElement._aiTypingTimer); delete messageElement._aiTypingTimer; } } catch (e) {}

        return new Promise((resolve) => {
            let watchdog = null;
            const finalize = () => {
                try {
                    try { if (messageElement._aiTypingTimer) { clearTimeout(messageElement._aiTypingTimer); delete messageElement._aiTypingTimer; } } catch (e) {}
                    if (watchdog) { clearTimeout(watchdog); watchdog = null; }

                    // Render final content (fullText) with safest options
                    try {
                        // Heuristic: if final text is a short/simple paragraph without lists/code blocks,
                        // render as plain text to preserve compact inline formatting and avoid layout shifts
                        const looksLikeComplex = /```|^\s*[-*+]\s|^\s*\d+\.\s|\n\s*\n/m.test(fullText || '');
                        if (!looksLikeComplex) {
                            // Keep simple responses as plain text to keep bubble compact
                            contentDiv.textContent = fullText;
                        } else if (typeof marked !== 'undefined') {
                            contentDiv.innerHTML = marked.parse(fullText || '');
                            this.cleanupTrailingEmptyBlocks(contentDiv);
                        } else {
                            contentDiv.textContent = fullText;
                        }
                    } catch (e) {
                        // If markdown parsing fails for the full content, fallback to plain text
                        console.warn('[Chat] Final render markdown failed:', e);
                        try { contentDiv.textContent = fullText; } catch (e2) { /* ignore */ }
                    }

                    try { this.highlightBlocks(messageElement); } catch (e) { console.warn('[Chat] highlightBlocks error on finalize:', e); }
                    this.scrollToBottom();
                } catch (e) {
                    console.warn('[Chat] finalize error:', e);
                }
                resolve();
            };

            if (mode === 'word') {
                // Word-by-word animation (preserving whitespace tokens)
                const tokens = displaySafeText.split(/(\s+)/g).filter(t => t !== undefined);
                let idx = 0;
                const total = tokens.length || 1;
                // Compute dynamic delay per token for natural pace
                const baseDelay = Math.max(16, Math.min(60, Math.floor(800 / Math.max(1, total))));
                watchdog = setTimeout(() => { console.warn('[Chat] animateAIResponse watchdog triggered; finalizing display'); finalize(); }, Math.min(30000, Math.max(5000, total * 50)));

                const stepWord = () => {
                    try {
                        const partial = tokens.slice(0, idx + 1).join('');
                        contentDiv.textContent = partial;
                        this.scrollToBottom();
                        idx++;
                        if (idx < total) {
                            messageElement._aiTypingTimer = setTimeout(stepWord, baseDelay);
                        } else {
                            finalize();
                        }
                    } catch (e) {
                        console.warn('[Chat] word step error:', e);
                        finalize();
                    }
                };

                // Start
                try { stepWord(); } catch (e) { console.warn('[Chat] animate start error:', e); finalize(); }

            } else {
                // chunk mode (existing behavior) - split into lines
                const words = displaySafeText.split(/(\n+)/g);
                let i = 0;
                const total = words.length || 1;
                const chunkSize = Math.max(1, Math.min(8, Math.floor(Math.sqrt(total))));
                const baseDelay = Math.max(12, Math.min(40, Math.floor(800 / Math.sqrt(total))));
                watchdog = setTimeout(() => { console.warn('[Chat] animateAIResponse watchdog triggered; finalizing display'); finalize(); }, Math.min(30000, Math.max(5000, total * 20)));

                const step = () => {
                    try {
                        i = Math.min(total, i + chunkSize);
                        const partial = words.slice(0, i).join('');
                        contentDiv.textContent = partial;
                        this.scrollToBottom();
                        if (i < total) {
                            messageElement._aiTypingTimer = setTimeout(step, baseDelay);
                        } else {
                            finalize();
                        }
                    } catch (e) {
                        console.warn('[Chat] animateAIResponse step error:', e);
                        finalize();
                    }
                };

                try { step(); } catch (e) { console.warn('[Chat] animate start error:', e); finalize(); }
            }
        });
    }

    enrichCodeBlocks(messageDiv) {
        const codeBlocks = messageDiv.querySelectorAll('pre code');
        codeBlocks.forEach(codeEl => {
            const preEl = codeEl.parentElement;
            if (preEl.classList.contains('code-wrapper')) return;

            const languageMatch = (codeEl.className || '').match(/language-([a-z0-9+-]+)/i);
            const language = languageMatch ? languageMatch[1].toUpperCase() : 'CODE';

            const wrapper = document.createElement('div');
            wrapper.className = 'code-wrapper';

            const header = document.createElement('div');
            header.className = 'code-wrapper__header';

            const langBadge = document.createElement('span');
            langBadge.className = 'code-wrapper__lang';
            langBadge.textContent = language;

            const copyBtn = document.createElement('button');
            copyBtn.className = 'code-wrapper__copy';
            copyBtn.textContent = 'Copy';
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(codeEl.innerText);
                    copyBtn.textContent = 'Copied';
                    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
                } catch {}
            });

            header.appendChild(langBadge);
            header.appendChild(copyBtn);

            const body = document.createElement('div');
            body.className = 'code-wrapper__body';
            body.appendChild(codeEl);

            wrapper.appendChild(header);
            wrapper.appendChild(body);

            preEl.replaceWith(wrapper);
        });
    }

    setRetryTarget(messageElement) {
        const buttons = this.messagesContainer.querySelectorAll('.retry-btn');
        buttons.forEach(btn => btn.disabled = true);
        const thisRetry = messageElement.querySelector('.retry-btn');
        if (thisRetry) thisRetry.disabled = false;
    }

    async retryMessage(messageElement) {
        const prompt = messageElement?.dataset.prompt || this.getLastUserMessage();
        if (!prompt) return;

        // Remove last assistant message from history so we can replace it
        for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
            if (this.conversationHistory[i].role === 'assistant') {
                this.conversationHistory.splice(i, 1);
                break;
            }
        }

        this.isLoading = true;
        this.sendBtn.disabled = true;
        this.messageInput.disabled = true;
        this.inputStatus.textContent = '';

        // Show typing indicator inside the targeted message instead of text
        const typingId = this.showInlineTypingIndicator(messageElement);
        const contentDiv = messageElement.querySelector('.message-content');

        // Remove any existing source blocks (both old and new classes)
        const existingSources = messageElement.querySelectorAll('.message-sources, .message-sources-inline');
        existingSources.forEach(el => el.remove());

        try {
            // Use fast short response for perceived latency (consistent with regular send)
            const response = await apiClient.sendMessage(
                prompt,
                this.conversationHistory,
                this.webSearchEnabled,
                { fast: true, maxTokens: 96 }
            );

            // Add a short pause then animate the response into the existing message element
            const estimatedDelay = Math.min(1000 + Math.floor((response?.answer || '').length / 40) * 40, 1800);
            await new Promise(r => setTimeout(r, estimatedDelay));

            // If there's no answer in the response, show an explicit message
            if (!response || !response.answer) {
                if (typingId) this.removeTypingIndicator(typingId);
                if (contentDiv) this.renderMessageContent(contentDiv, 'ai', 'No response received. Please try again.');
                this.inputStatus.textContent = 'No response received';
                setTimeout(() => { if (this.inputStatus && this.inputStatus.textContent === 'No response received') this.inputStatus.textContent = ''; }, 4000);
                return;
            }

            // Remove the inline typing indicator then animate into the message
            if (typingId) this.removeTypingIndicator(typingId);

            // Await the animation so state updates happen in order
            await this.animateAIResponse(messageElement, response?.answer || '', { mode: 'word' });

            // Sources display is disabled by user preference — do not append source pills during retry
            // (we still keep sources in the response payload for potential future use)

            // Save the assistant response to conversation history and persist
            this.conversationHistory.push({ role: 'assistant', content: response?.answer || '' });
            this.persistHistory();

            // Update retry buttons so only this message's retry is enabled
            this.setRetryTarget(messageElement);

            // Surface search errors from the server to the UI briefly
            if (response && response.searchError) {
                this.inputStatus.textContent = response.searchError;
                setTimeout(() => {
                    if (this.inputStatus && this.inputStatus.textContent === response.searchError) this.inputStatus.textContent = '';
                }, 6000);
            }
        } catch (error) {
            if (typingId) this.removeTypingIndicator(typingId);
            // Render a clear, safe error message into the content area
            if (contentDiv) {
                this.renderMessageContent(contentDiv, 'ai', `Error: ${error.message || 'Retry failed'}`);
            }
            console.error('[Chat] retryMessage error:', error);
            this.inputStatus.textContent = error.message || 'Retry failed';
            setTimeout(() => { if (this.inputStatus && this.inputStatus.textContent === (error.message || 'Retry failed')) this.inputStatus.textContent = ''; }, 4000);
        } finally {
            this.isLoading = false;
            this.sendBtn.disabled = false;
            this.messageInput.disabled = false;
            this.scrollToBottom();
        }
    }

    getLastUserMessage() {
        for (let i = this.conversationHistory.length - 1; i >= 0; i--) {
            if (this.conversationHistory[i].role === 'user') {
                return this.conversationHistory[i].content;
            }
        }
        return '';
    }

    getLocaleLabels() {
        const isFR = (document.documentElement.lang || '').startsWith('fr');
        return {
            copy: isFR ? 'Copier' : 'Copy',
            copied: isFR ? 'Copié' : 'Copied',
            retry: isFR ? 'Réessayer' : 'Retry'
        };
    }

    showTypingIndicator() {
        // Prevent duplicate typing indicators: if one already exists, return its id
        try {
            const existingIndicator = this.messagesContainer.querySelector('.message.ai[data-typing="true"] .typing-indicator') || this.messagesContainer.querySelector('.message.ai .typing-indicator');
            if (existingIndicator) {
                const parent = existingIndicator.closest('.message.ai');
                if (parent) {
                    if (!parent.id) parent.id = 'typing-indicator-' + Date.now();
                    try { parent.dataset.typing = 'true'; } catch (e) {}
                    this._activeTypingIndicators.add(parent.id);
                    if (this.debug) console.debug('[ChatManager] Reusing existing global typing indicator', parent.id);
                    return parent.id;
                }
            }
        } catch (e) {}

        const typingDiv = document.createElement('div');
        typingDiv.className = 'message ai';
        typingDiv.id = 'typing-indicator-' + Date.now();
        try { typingDiv.dataset.typing = 'true'; } catch (e) {}

        // Use same structure as normal messages so it appears as a bubble
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        const indicatorContent = document.createElement('div');
        indicatorContent.className = 'typing-indicator';

        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.className = 'typing-dot';
            indicatorContent.appendChild(dot);
        }

        contentDiv.appendChild(indicatorContent);
        typingDiv.appendChild(contentDiv);
        this.messagesContainer.appendChild(typingDiv);
        this.scrollToBottom();

        this._activeTypingIndicators.add(typingDiv.id);
        if (this.debug) console.debug('[ChatManager] Created global typing indicator', typingDiv.id);
        return typingDiv.id;
    }

    // Show typing indicator inside an existing message element (used for retry)
    showInlineTypingIndicator(messageElement) {
        const contentDiv = messageElement.querySelector('.message-content');
        if (!contentDiv) return null;

        // If there's already a typing indicator inline, return its id
        try {
            const existing = contentDiv.querySelector('.typing-indicator');
            if (existing) {
                if (existing.id) {
                    try { messageElement.dataset.typing = 'true'; } catch (e) {}
                    this._activeTypingIndicators.add(existing.id);
                    if (this.debug) console.debug('[ChatManager] Reusing existing inline typing indicator', existing.id);
                    return existing.id;
                }
                const parent = existing.closest('.message') || messageElement;
                if (parent && !parent.id) parent.id = 'typing-indicator-inline-' + Date.now();
                try { parent.dataset.typing = 'true'; } catch (e) {}
                this._activeTypingIndicators.add(parent.id || '');
                return parent.id || null;
            }
        } catch (e) {}

        // Remove any global typing indicators elsewhere to avoid duplicate bubbles
        try {
            const globals = Array.from(this.messagesContainer.querySelectorAll('.message.ai .typing-indicator'));
            globals.forEach(el => {
                const owner = el.closest('.message');
                if (!owner || owner === messageElement) return;
                if (this.debug) console.debug('[ChatManager] Removing global typing indicator in', owner.id || '<no-id>', 'because an inline indicator is being created');
                try { owner.remove(); } catch (e) {}
                try { if (owner.id) this._activeTypingIndicators.delete(owner.id); } catch (e) {}
            });
        } catch (e) {}



        // clear existing content and insert typing indicator
        contentDiv.innerHTML = '';
        const indicator = document.createElement('div');
        const id = 'typing-indicator-inline-' + Date.now();
        indicator.id = id;
        indicator.className = 'typing-indicator';
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.className = 'typing-dot';
            indicator.appendChild(dot);
        }
        contentDiv.appendChild(indicator);
        try { messageElement.dataset.typing = 'true'; } catch (e) {}
        this._activeTypingIndicators.add(id);
        if (this.debug) console.debug('[ChatManager] Created inline typing indicator', id);
        this.scrollToBottom();
        return id;
    }

    // Remove or sanitize old assistant messages (fixes legacy stacked URL bug)
    cleanUpOldMessages() {
        const messages = this.messagesContainer.querySelectorAll('.message.ai');
        messages.forEach(msg => {
            const contentDiv = msg.querySelector('.message-content');
            if (!contentDiv) return;
            const raw = contentDiv.innerText || contentDiv.textContent || '';
            const cleaned = this.sanitizeContent(raw || '');
            if (cleaned !== (raw || '').trim()) {
                try {
                    if (typeof marked !== 'undefined') {
                        contentDiv.innerHTML = marked.parse(cleaned || '');
                    } else {
                        contentDiv.textContent = cleaned || '';
                    }
                } catch (e) {
                    contentDiv.textContent = cleaned || '';
                }
            }

            // Remove any old-format source lists appended as direct sibling elements (.message-old-sources)
            const oldSources = msg.querySelectorAll('.message-old-sources, .message-sources-list, .raw-source-line');
            oldSources.forEach(s => s.remove());
        });
    }

    // Purge legacy block elements that contain DuckDuckGo redirect fragments or encoded uddg lines
    purgeLegacySourceNodes() {
        if (!this.messagesContainer) return;
        const nodes = Array.from(this.messagesContainer.querySelectorAll('.message'));
        const suspectRe = /duckduckgo\.com\/l\//i;
        const uddgRe = /\buddg=/i;
        const encodedRe = /(%3A|%2F|%3D|%26|%3F)/i;

        nodes.forEach(msg => {
            // For each direct child of message (except known classes), remove if it looks like a raw encoded URL block
            Array.from(msg.children).forEach(child => {
                if (child.classList && (child.classList.contains('message-content') || child.classList.contains('message-actions') || child.classList.contains('message-sources-inline'))) return;
                const txt = (child.innerText || child.textContent || '').trim();
                if (!txt) return;
                // If this child contains duckduckgo redirect or uddg param or many encoded tokens, remove it
                if (suspectRe.test(txt) || uddgRe.test(txt) || (encodedRe.test(txt) && txt.length > 24)) {
                    child.remove();
                    return;
                }
            });

            // Remove any legacy inline source pills or citation blocks entirely
            const legacyInlines = msg.querySelectorAll('.message-sources-inline, .inline-citations, .message-sources');
            legacyInlines.forEach(n => n.remove());

            // Also scan contentDiv for multiple lines that purely look like uddg/raw redirect lines and remove them
            const contentDiv = msg.querySelector('.message-content');
            if (contentDiv) {
                const ln = (contentDiv.innerText || contentDiv.textContent || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                const remaining = ln.filter(line => {
                    if (suspectRe.test(line) || uddgRe.test(line) || (encodedRe.test(line) && line.length > 24)) return false;
                    return true;
                });
                if (remaining.join('\n').trim() !== ln.join('\n').trim()) {
                    // replace with sanitized content
                    const cleaned = remaining.join('\n').trim() || '(source lines removed)';
                    try {
                        if (typeof marked !== 'undefined') contentDiv.innerHTML = marked.parse(cleaned);
                        else contentDiv.textContent = cleaned;
                    } catch (e) { contentDiv.textContent = cleaned; }
                }
            }
        });

        // Also remove any stray nodes directly under messagesContainer that are not '.message' and contain encoded redirect text
        const containerChildren = Array.from(this.messagesContainer.children);
        containerChildren.forEach(child => {
            if (child.classList && child.classList.contains('message')) return;
            const txt = (child.innerText || child.textContent || '').trim();
            if (!txt) return;
            if (suspectRe.test(txt) || uddgRe.test(txt) || (encodedRe.test(txt) && txt.length > 24)) {
                child.remove();
            }
        });

        // Ensure only a single inline sources pill per message
        this.messagesContainer.querySelectorAll('.message').forEach(msg => {
            const inlines = msg.querySelectorAll('.message-sources-inline');
            if (inlines.length > 1) {
                for (let i = 1; i < inlines.length; i++) inlines[i].remove();
            }
        });
    }

    // Upgrade pass to fix legacy inline source pills that show arrows or duplicate counts
    updateLegacyInlineSources() {
        if (!this.messagesContainer) return;
        const nodes = Array.from(this.messagesContainer.querySelectorAll('.message-sources-inline'));
        nodes.forEach(el => {
            // Remove any small arrow glyph nodes
            el.querySelectorAll('*').forEach(n => {
                try {
                    if ((n.innerText || '').trim() === '›' || (n.innerText || '').trim() === '◀' || /^\W+$/.test((n.innerText||'').trim())) n.remove();
                } catch (e) {}
            });

            // Ensure a mini-wrap exists and contains at least placeholder icons
            let miniWrap = el.querySelector('.source-mini-wrap');
            if (!miniWrap) {
                miniWrap = document.createElement('div');
                miniWrap.className = 'source-mini-wrap';
                el.insertBefore(miniWrap, el.firstChild);
            }

            // If no image icons present, create simple placeholders (up to 3)
            if (!miniWrap.querySelector('img') && !miniWrap.querySelector('.source-mini-placeholder')) {
                const countEl = el.querySelector('.sources-count-green');
                let cnt = 3;
                if (countEl) {
                    const v = String(countEl.textContent || '').replace(/\D/g, '');
                    cnt = Math.min(3, Math.max(1, parseInt(v || '3')));
                }
                miniWrap.innerHTML = '';
                for (let i = 0; i < cnt; i++) {
                    const ph = document.createElement('div');
                    ph.className = 'source-mini-placeholder source-mini-inline';
                    ph.textContent = '';
                    miniWrap.appendChild(ph);
                }
            }

            // Ensure the pill label is concise (avoid repeating numeric count)
            const pillUrl = el.querySelector('.pill-url');
            const countEl = el.querySelector('.sources-count-green');
            if (pillUrl && countEl) {
                const n = parseInt(String(countEl.textContent || '').replace(/\D/g, '')) || 0;
                if (n > 1) {
                    pillUrl.textContent = document.documentElement.lang && document.documentElement.lang.startsWith('fr') ? 'sources' : 'sources';
                    pillUrl.title = `${n} sources`;
                }
                // Normalize count to numeric only
                countEl.textContent = String(n || countEl.textContent || '').replace(/\D/g, '');
            }

            // Replace any tiny/broken icons in this pill immediately
            try { this.fixBrokenFaviconsInNode(el); } catch (e) { /* ignore */ }
        });
    }

    // Attach a favicon to a container with robust fallbacks and size checks
    appendFaviconTo(container, host, title, opts = {}) {
        try {
            if (!host) {
                const ph = document.createElement('div');
                ph.className = (opts.placeholderClass || 'source-mini-placeholder') + ' ' + (opts.extraInlineClass || 'source-mini-inline');
                ph.textContent = (opts.text || (host && host[0] && host[0].toUpperCase())) || '?';
                container.appendChild(ph);
                return;
            }
            const hostFavicon = `https://${host}/favicon.ico`;
            const ddgIcon = `https://icons.duckduckgo.com/ip3/${host}.ico`;

            const img = document.createElement('img');
            img.className = (opts.className || 'source-mini source-mini-inline');
            img.alt = host;
            img.title = title || host;
            img.crossOrigin = 'anonymous';

            let triedDDG = false;
            let settled = false;

            const usePlaceholder = () => {
                if (settled) return;
                settled = true;
                try { img.remove(); } catch (e) {}
                const ph = document.createElement('div');
                ph.className = (opts.placeholderClass || 'source-mini-placeholder') + ' ' + (opts.extraInlineClass || 'source-mini-inline');
                ph.textContent = (host && host[0]) ? host[0].toUpperCase() : '?';
                container.appendChild(ph);
            };

            img.onload = () => {
                try {
                    if (img.naturalWidth && img.naturalWidth >= 16 && img.naturalHeight >= 16) {
                        settled = true;
                        return; // good
                    }
                } catch (e) {}
                // Try ddg fallback once
                if (!triedDDG) { triedDDG = true; img.onerror = null; img.src = ddgIcon; return; }
                usePlaceholder();
            };
            img.onerror = () => {
                if (!triedDDG) { triedDDG = true; img.onerror = null; img.src = ddgIcon; return; }
                usePlaceholder();
            };

            // Append first, then start loading host favicon
            container.appendChild(img);
            img.src = hostFavicon;

            // Safety timeout: if not settled within 1.6s, fallback to ddg or placeholder
            setTimeout(() => {
                if (settled) return;
                try {
                    if (!img.naturalWidth || img.naturalWidth < 12) {
                        if (!triedDDG) { triedDDG = true; img.onerror = null; img.src = ddgIcon; return; }
                        usePlaceholder();
                    }
                } catch (e) { usePlaceholder(); }
            }, 1600);
        } catch (e) {
            try { const ph = document.createElement('div'); ph.className = 'source-mini-placeholder source-mini-inline'; ph.textContent = (host && host[0]) ? host[0].toUpperCase() : '?'; container.appendChild(ph); } catch (e) {}
        }
    }

    // Scan for tiny or broken favicon images inside a node and replace them with placeholders
    fixBrokenFaviconsInNode(node) {
        try {
            const imgs = Array.from(node.querySelectorAll('img.source-mini, img.sp-favicon'));
            imgs.forEach(img => {
                try {
                    if (img.complete) {
                        if (!img.naturalWidth || img.naturalWidth < 12) {
                            // replace with placeholder
                            const parent = img.parentElement || node;
                            const host = (img.alt || '').replace(/^www\./, '');
                            try { img.remove(); } catch (e) {}
                            const ph = document.createElement('div');
                            ph.className = (img.classList.contains('sp-favicon') ? 'sp-favicon-placeholder' : 'source-mini-placeholder') + ' ' + (img.classList.contains('source-mini-inline') ? 'source-mini-inline' : '');
                            ph.textContent = (host && host[0]) ? host[0].toUpperCase() : '?';
                            parent.insertBefore(ph, parent.querySelector('.sp-body') || null);
                        }
                    } else {
                        // schedule a re-check shortly
                        setTimeout(() => { try { this.fixBrokenFaviconsInNode(node); } catch (e) {} }, 600);
                    }
                } catch (e) {}
            });
        } catch (e) {}
    }

    removeTypingIndicator(id) {
        try {
            if (id) {
                const element = document.getElementById(id);
                if (element) {
                    try { element.remove(); } catch (e) {}
                    try { delete element.dataset.typing; } catch (e) {}
                }
                this._activeTypingIndicators.delete(id);
                if (this.debug) console.debug('[ChatManager] Removed typing indicator by id', id);
            }
            // Also remove any leftover typing indicators to avoid duplicates
            const leftovers = Array.from(this.messagesContainer.querySelectorAll('.message.ai'));
            leftovers.forEach(msg => {
                if (msg.querySelector('.typing-indicator')) {
                    try { msg.remove(); } catch (e) {}
                    try { delete msg.dataset.typing; } catch (e) {}
                    if (msg.id) this._activeTypingIndicators.delete(msg.id);
                    if (this.debug) console.debug('[ChatManager] Removed leftover typing indicator', msg.id || '<no-id>');
                }
            });
        } catch (e) {}
    }

    scrollToBottom() {
        setTimeout(() => {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        }, 0);
    }

    async logout() {
        apiClient.logout();
        localStorage.removeItem('guestMode');
        window.location.href = '/';
    }

    redirectToLogin() {
        this.messagesContainer.innerHTML = `
            <div class="welcome-message">
                <h2>Authentication Required</h2>
                <p>Please log in to access the chat.</p>
                <a href="/login" style="color: #00ff00; text-decoration: none; margin-top: 1rem; display: inline-block;">Go to Login</a>
            </div>
        `;
    }

    persistHistory() {
        if (this.isGuest) return; // Do not save history in guest mode
        try { 
            localStorage.setItem('luckai_history', JSON.stringify(this.conversationHistory)); 
        } catch (e) {
            console.error('Failed to persist history:', e);
        }
    }

    restoreHistory() {
        if (this.isGuest) return; // Do not restore history in guest mode
        try {
            const raw = localStorage.getItem('luckai_history');
            if (!raw) return;
            const arr = JSON.parse(raw);
            if (!Array.isArray(arr)) return;
            this.conversationHistory = [];
            this.messagesContainer.innerHTML = '';
            // One-time backup of raw history (so we can revert if needed)
            try {
                if (!localStorage.getItem('luckai_history_backup_v1')) {
                    localStorage.setItem('luckai_history_backup_v1', raw);
                    console.info('LuckAI: Backed up raw conversation history to luckai_history_backup_v1');
                }
            } catch (e) { /* ignore */ }

            let sanitizedCount = 0;
            const newHistory = [];

            arr.forEach(msg => {
                // Display role mapping: stored 'assistant' should render as 'ai' in the UI
                const displayRole = msg.role === 'assistant' ? 'ai' : msg.role;
                let content = msg.content || '';

                // Sanitize restored assistant messages: strip 'System:' echoes or repeated welcome text
                if (displayRole === 'ai') {
                    content = content.replace(/^System:\s*/i, '').replace(/^You are Luck[^\n]*\n?/i, '').trim();
                    // Remove common canned initial phrases
                    content = content.replace(/^(Hello\s*Luck\b[\s\S]*?please provide your first request\.?)/i, '').trim();
                    // Run the generic sanitizer to remove uddg/redirect lines
                    const cleaned = this.sanitizeContent(content || '');
                    if (cleaned !== (content || '')) sanitizedCount++;
                    content = cleaned || '(previous assistant message hidden)';
                }

                this.addMessage(content, displayRole);
                // Store sanitized content in conversationHistory so it won't reappear when persisted
                newHistory.push({ role: msg.role, content: content });
            });

            if (sanitizedCount > 0) {
                console.info(`LuckAI: Sanitized ${sanitizedCount} assistant messages during restore`);
                // Overwrite stored history with sanitized content to prevent reappearance
                try { localStorage.setItem('luckai_history', JSON.stringify(newHistory)); } catch (e) { console.error('Failed to persist sanitized history:', e); }
                // Also set the in-memory history
                this.conversationHistory = newHistory.slice();

                // Non-intrusive UI notification informing the user of the sanitization
                try {
                    const note = document.createElement('div');
                    note.className = 'notification success';
                    note.textContent = `${sanitizedCount} old messages were sanitized to remove legacy redirect lines. A backup was saved.`;
                    note.style.cssText = `position: fixed; top: 16px; right: 16px; background: #00ff00; color: #000; padding: 10px 14px; border-radius: 6px; z-index: 10000; font-weight: 600;`;
                    document.body.appendChild(note);
                    setTimeout(() => { note.style.transition = 'opacity 0.3s'; note.style.opacity = '0'; setTimeout(() => note.remove(), 300); }, 5000);
                } catch (e) { /* ignore UI notification failures */ }

            } else {
                // No sanitization was necessary; keep the original array
                this.conversationHistory = arr.slice();
            }

                    // After restoring messages, clean up any old assistant messages that contain raw redirect URLs
            this.cleanUpOldMessages();
            // Also purge any legacy source blocks that were inserted as separate nodes
            this.purgeLegacySourceNodes();
            // Upgrade any legacy inline source pills so they show favicons/placeholders and a single numeric badge
            try { this.updateLegacyInlineSources(); } catch (e) { /* ignore */ }
        } catch (e) {
            console.error('Failed to restore history:', e);
        }
    }

    resetHistory() {
        if (confirm('Are you sure you want to clear all chat history? This cannot be undone.')) {
            // Clear conversation history
            this.conversationHistory = [];
            
            // Clear messages from UI
            this.messagesContainer.innerHTML = `
                <div class="welcome-message">
                    <h2>Welcome to LuckAI</h2>
                    <p>Ask me anything in English or French</p>
                </div>
            `;
            
            // Clear localStorage
            localStorage.removeItem('luckai_history');
            
            // Show confirmation
            const notification = document.createElement('div');
            notification.className = 'notification success';
            notification.textContent = 'Chat history cleared successfully';
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #00ff00;
                color: #000;
                padding: 1rem 1.5rem;
                border-radius: 6px;
                font-weight: 600;
                z-index: 10000;
                animation: slideIn 0.3s ease;
            `;
            document.body.appendChild(notification);
            
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => notification.remove(), 300);
            }, 2000);
        }
    }
}

// Initialize chat when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chatManager = new ChatManager();
    // Run a quick cleanup of any legacy messages that might contain raw redirect URLs
    setTimeout(() => { try { window.chatManager.cleanUpOldMessages(); } catch (e) { /* ignore */ } }, 250);
});
