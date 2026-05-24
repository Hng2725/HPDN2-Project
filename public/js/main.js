/* ================================================================
   ChatGPT Fake — main.js
   Quản lý: Chat history, API calls, UI state, LocalStorage
   ================================================================ */

// ── Khởi tạo Lucide icons ngay khi load ──
lucide.createIcons();

// ── State ──
let chats = [];
let currentChatId = null;
let currentMessages = [];
let isLoading = false;

// ── DOM References ──
const apiKeyInput   = document.getElementById('apiKey');
const userInput     = document.getElementById('userInput');
const sendBtn       = document.getElementById('sendBtn');
const chatContainer = document.getElementById('chatContainer');
const historyList   = document.getElementById('historyList');
const chatTitle     = document.getElementById('chatTitle');
const modelSelect   = document.getElementById('modelSelect');
const toastEl       = document.getElementById('toast');

// ── Restore API key từ localStorage ──
const savedKey = localStorage.getItem('openrouter_key');
if (savedKey) apiKeyInput.value = savedKey;

function saveApiKey() {
    localStorage.setItem('openrouter_key', apiKeyInput.value.trim());
}

// ── Restore model selection (với validation) ──
const VALID_MODELS = [
    'openrouter/free',
    'deepseek/deepseek-v4-flash:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemma-4-31b-it:free',
    'qwen/qwen3-coder:free',
    'openai/gpt-oss-20b:free',
    'openai/gpt-oss-120b:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'meta-llama/llama-3.2-3b-instruct:free',
    'openai/gpt-4o-mini',
    'anthropic/claude-3-haiku',
];
const savedModel = localStorage.getItem('selected_model');
if (savedModel && VALID_MODELS.includes(savedModel)) {
    const opt = modelSelect.querySelector(`option[value="${savedModel}"]`);
    if (opt) modelSelect.value = savedModel;
} else if (savedModel) {
    // Model cũ không còn hợp lệ → reset về default
    localStorage.removeItem('selected_model');
}
modelSelect.addEventListener('change', () => {
    localStorage.setItem('selected_model', modelSelect.value);
});

/* ── Toast helper ── */
let toastTimer = null;
function showToast(msg, type = '') {
    toastEl.textContent = msg;
    toastEl.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastEl.className = 'toast';
    }, 3000);
}

/* ── Sidebar toggle (mobile) ── */
let overlay = null;
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');

    // Overlay cho mobile
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.addEventListener('click', () => toggleSidebar());
        document.body.appendChild(overlay);
    }
    overlay.classList.toggle('show', sidebar.classList.contains('open'));
}

/* ── Auto-resize textarea ── */
userInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 200) + 'px';
});

/* ── Enter key handler ── */
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

/* ─────────────────────────────────────────────
   CHAT HISTORY (Load / Render / Switch / Delete)
   ───────────────────────────────────────────── */

async function loadChats() {
    try {
        const res = await fetch('/api/chats');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        chats = await res.json();
        renderHistory();

        if (chats.length > 0) {
            switchChat(chats[0].id);
        } else {
            showWelcome();
        }
    } catch (err) {
        console.error('Không tải được lịch sử chat:', err);
        showWelcome();
        showToast('⚠️ Không kết nối được server', 'error');
    }
}

function renderHistory() {
    historyList.innerHTML = '';

    if (chats.length === 0) {
        historyList.innerHTML = '<p class="history-empty">Chưa có cuộc trò chuyện nào</p>';
        return;
    }

    chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = `history-item${chat.id === currentChatId ? ' active' : ''}`;
        item.dataset.chatId = chat.id;
        item.innerHTML = `
            <i data-lucide="message-square" width="15" height="15"></i>
            <span title="${escapeHtml(chat.title)}">${escapeHtml(chat.title)}</span>
            <button class="delete-btn" onclick="deleteChat(event,'${chat.id}')" title="Xóa" aria-label="Xóa cuộc trò chuyện">
                <i data-lucide="x" width="13" height="13"></i>
            </button>
        `;
        item.addEventListener('click', () => switchChat(chat.id));
        historyList.appendChild(item);
    });

    lucide.createIcons();
}

async function switchChat(id) {
    if (currentChatId === id) return;
    currentChatId = id;
    const chat = chats.find(c => c.id === id);
    if (chat) chatTitle.textContent = chat.title;

    chatContainer.innerHTML = '';

    try {
        const res = await fetch(`/api/chats/${id}/messages`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        currentMessages = await res.json();

        if (currentMessages.length === 0) {
            showWelcome();
        } else {
            currentMessages.forEach(msg => appendMessage(msg.role, msg.content, false));
        }
        renderHistory();
        lucide.createIcons();
        scrollToBottom();
    } catch (err) {
        console.error('Không tải được tin nhắn:', err);
        showToast('❌ Lỗi tải tin nhắn', 'error');
    }
}

async function createNewChat() {
    const id = `chat_${Date.now()}`;
    const newChat = { id, title: 'Cuộc trò chuyện mới' };

    try {
        const res = await fetch('/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newChat)
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        chats.unshift(newChat);
        currentMessages = [];
        renderHistory();
        await switchChat(id);

        if (window.innerWidth < 768 && document.getElementById('sidebar').classList.contains('open')) {
            toggleSidebar();
        }
        userInput.focus();
    } catch (err) {
        console.error('Tạo chat thất bại:', err);
        showToast('❌ Không tạo được chat mới', 'error');
    }
}

async function deleteChat(event, id) {
    event.stopPropagation();
    if (!confirm('Xóa cuộc trò chuyện này?')) return;

    try {
        const res = await fetch(`/api/chats/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        chats = chats.filter(c => c.id !== id);

        if (currentChatId === id) {
            currentChatId = null;
            currentMessages = [];
            if (chats.length > 0) {
                switchChat(chats[0].id);
            } else {
                showWelcome();
            }
        }
        renderHistory();
        showToast('🗑️ Đã xóa cuộc trò chuyện', '');
    } catch (err) {
        console.error('Xóa chat thất bại:', err);
        showToast('❌ Xóa thất bại', 'error');
    }
}

async function clearCurrentChat() {
    if (!currentChatId) return;
    if (!confirm('Xóa cuộc trò chuyện đang mở?')) return;
    await deleteChat({ stopPropagation: () => {} }, currentChatId);
}

/* ─────────────────────────────
   WELCOME SCREEN
   ───────────────────────────── */
const EXAMPLE_PROMPTS = [
    '💡 Giải thích AI là gì?',
    '🐍 Viết code Python đọc file CSV',
    '📝 Tóm tắt văn bản cho tôi',
    '🌐 Dịch sang tiếng Anh',
    '🔧 Debug code JavaScript',
];

function showWelcome() {
    chatTitle.textContent = 'AI Assistant';
    currentMessages = [];
    chatContainer.innerHTML = `
        <div class="welcome-screen">
            <div class="logo-icon">
                <i data-lucide="bot" color="white" width="28" height="28"></i>
            </div>
            <h2>Xin chào! Tôi có thể giúp gì?</h2>
            <p>Chọn một câu hỏi gợi ý hoặc nhập câu hỏi của bạn bên dưới.</p>
            <div class="welcome-chips">
                ${EXAMPLE_PROMPTS.map(p => `<button class="chip" onclick="setPrompt('${p.replace(/'/g, "\\'")}')">${p}</button>`).join('')}
            </div>
        </div>
    `;
    lucide.createIcons();
}

function setPrompt(text) {
    userInput.value = text;
    userInput.dispatchEvent(new Event('input'));
    userInput.focus();
}

/* ─────────────────────────────
   MESSAGES — Append / Render
   ───────────────────────────── */

function appendMessage(role, content, saveToList = true) {
    // Xóa welcome screen nếu còn
    const welcome = chatContainer.querySelector('.welcome-screen');
    if (welcome) chatContainer.innerHTML = '';

    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role}`;
    const icon = role === 'user' ? 'user' : 'bot';

    let renderedContent;
    try {
        renderedContent = marked.parse(content);
    } catch {
        renderedContent = escapeHtml(content);
    }

    msgDiv.innerHTML = `
        <div class="avatar"><i data-lucide="${icon}" color="white" width="18" height="18"></i></div>
        <div class="message-content">${renderedContent}</div>
    `;

    chatContainer.appendChild(msgDiv);
    scrollToBottom();

    msgDiv.querySelectorAll('pre code').forEach(block => {
        try { hljs.highlightElement(block); } catch {}
    });

    lucide.createIcons();

    if (saveToList) {
        currentMessages.push({ role, content });
    }
}

function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

/* ─────────────────────────────
   SEND MESSAGE — Core logic
   ───────────────────────────── */

async function sendMessage() {
    const content = userInput.value.trim();
    const apiKey  = apiKeyInput.value.trim();

    if (!content || isLoading) return;

    isLoading = true;
    sendBtn.disabled = true;
    userInput.value = '';
    userInput.style.height = 'auto';

    // Tạo chat mới nếu chưa có
    if (!currentChatId) {
        await createNewChat();
    }

    // Hiển thị và lưu tin nhắn user
    appendMessage('user', content);
    await saveMessageToDB('user', content);

    // Cập nhật title nếu đây là tin nhắn đầu tiên
    if (currentMessages.length === 1) {
        const newTitle = content.substring(0, 30) + (content.length > 30 ? '…' : '');
        const chat = chats.find(c => c.id === currentChatId);
        if (chat) {
            chat.title = newTitle;
            chatTitle.textContent = newTitle;
            renderHistory();
        }
    }

    // Loading indicator
    const loadingDiv = createLoadingBubble();
    chatContainer.appendChild(loadingDiv);
    scrollToBottom();
    lucide.createIcons();

    try {
        const systemPrompt = {
            role: 'system',
            content: 'Bạn là trợ lý AI thông minh, thân thiện. Luôn trả lời bằng tiếng Việt chuẩn mực, đúng chính tả, văn phong tự nhiên và dễ hiểu. Định dạng câu trả lời bằng Markdown khi phù hợp.'
        };

        const res = await fetch('/api/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: modelSelect.value,
                messages: [systemPrompt, ...currentMessages],
                apiKey
            })
        });

        loadingDiv.remove();

        // Kiểm tra Content-Type — nếu là SSE thì stream, không thì parse JSON lỗi
        const contentType = res.headers.get('content-type') || '';

        if (!contentType.includes('text/event-stream')) {
            // Lỗi trả về dạng JSON (400, 402, 429...)
            const data = await res.json();
            if (data.error) {
                appendMessage('assistant', `❌ **Lỗi:** ${mapErrorMessage(data.error)}`, false);
                showToast('⚠️ Model trả về lỗi', 'error');
            }
            return;
        }

        // ── Streaming mode ──
        // Tạo bubble trả lời rỗng, sẽ điền dần
        const replyDiv = document.createElement('div');
        replyDiv.className = 'message assistant';
        replyDiv.innerHTML = `
            <div class="avatar"><i data-lucide="bot" color="white" width="18" height="18"></i></div>
            <div class="message-content streaming-content"></div>
        `;
        chatContainer.appendChild(replyDiv);
        lucide.createIcons();
        const contentEl = replyDiv.querySelector('.message-content');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // giữ lại dòng chưa hoàn chỉnh

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const raw = line.slice(6).trim();
                if (raw === '[DONE]') break;

                try {
                    const chunk = JSON.parse(raw);
                    const delta = chunk.choices?.[0]?.delta?.content;
                    if (delta) {
                        fullText += delta;
                        // Render markdown mỗi khi có thêm text
                        try {
                            contentEl.innerHTML = marked.parse(fullText);
                        } catch {
                            contentEl.textContent = fullText;
                        }
                        scrollToBottom();
                    }
                } catch { /* bỏ qua chunk parse lỗi */ }
            }
        }

        // Highlight code blocks sau khi stream xong
        replyDiv.querySelectorAll('pre code').forEach(block => {
            try { hljs.highlightElement(block); } catch {}
        });
        // Tắt blinking cursor
        contentEl.classList.remove('streaming-content');
        scrollToBottom();

        if (fullText) {
            currentMessages.push({ role: 'assistant', content: fullText });
            await saveMessageToDB('assistant', fullText);
        } else {
            contentEl.innerHTML = '⚠️ Không nhận được phản hồi. Thử đổi model khác!';
        }

    } catch (err) {
        loadingDiv.remove();
        appendMessage('assistant', '❌ **Lỗi kết nối.** Hãy kiểm tra backend server đang chạy và thử lại.', false);
        console.error('sendMessage error:', err);
        showToast('❌ Lỗi kết nối server', 'error');
    } finally {
        isLoading = false;
        sendBtn.disabled = false;
        userInput.focus();
    }
}

/* ─────────────────────────────
   HELPERS
   ───────────────────────────── */

async function saveMessageToDB(role, content) {
    try {
        const res = await fetch(`/api/chats/${currentChatId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, content })
        });
        if (!res.ok) console.warn(`saveMessageToDB: HTTP ${res.status}`);
    } catch (err) {
        console.error('Lỗi lưu tin nhắn:', err);
    }
}

function createLoadingBubble() {
    const div = document.createElement('div');
    div.className = 'message assistant';
    div.innerHTML = `
        <div class="avatar"><i data-lucide="bot" color="white" width="18" height="18"></i></div>
        <div class="message-content">
            <div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
        </div>
    `;
    return div;
}

function mapErrorMessage(error) {
    const msg = error.message || '';
    if (msg.includes('No endpoints found'))
        return 'Model này hiện không có endpoint. Vui lòng **chọn model khác** trong dropdown bên trên.';
    if (msg.includes('Provider returned error'))
        return 'Provider đang bận hoặc gặp lỗi. Thử lại sau hoặc **đổi model khác**.';
    if (msg.includes('401') || msg.includes('Invalid API key'))
        return 'API Key không hợp lệ. Kiểm tra lại Key của bạn.';
    if (msg.includes('rate limit') || msg.includes('429'))
        return 'Đã vượt giới hạn yêu cầu (rate limit). Thử lại sau vài giây.';
    return msg || 'Lỗi không xác định.';
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/* ─────────────────────────────
   INIT
   ───────────────────────────── */
document.addEventListener('DOMContentLoaded', loadChats);
