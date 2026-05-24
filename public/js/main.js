lucide.createIcons();

let chats = [];
let currentChatId = null;
let currentMessages = [];

// Initialize API Key
const apiKeyInput = document.getElementById('apiKey');
if (localStorage.getItem('openrouter_key')) {
    apiKeyInput.value = localStorage.getItem('openrouter_key');
}

function saveApiKey() {
    localStorage.setItem('openrouter_key', apiKeyInput.value);
}

const userInput = document.getElementById('userInput');

// Auto resize textarea
userInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
}

async function loadChats() {
    try {
        const response = await fetch('/api/chats');
        chats = await response.json();
        renderHistory();
        if (chats.length > 0 && !currentChatId) {
            switchChat(chats[0].id);
        } else if (chats.length === 0) {
            currentChatId = null;
            showWelcome();
        }
    } catch (error) {
        console.error('Failed to load chats:', error);
    }
}

async function createNewChat() {
    const id = Date.now().toString();
    const newChat = {
        id: id,
        title: 'Trò chuyện mới'
    };
    
    try {
        await fetch('/api/chats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newChat)
        });
        chats.unshift(newChat);
        renderHistory();
        switchChat(id);
        if (window.innerWidth < 768) toggleSidebar();
    } catch (error) {
        console.error('Failed to create chat:', error);
    }
}

function renderHistory() {
    const historyList = document.getElementById('historyList');
    historyList.innerHTML = '';
    chats.forEach(chat => {
        const item = document.createElement('div');
        item.className = `history-item ${chat.id === currentChatId ? 'active' : ''}`;
        item.innerHTML = `
            <i data-lucide="message-square" size="16"></i>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;">${chat.title}</span>
            <button class="delete-btn" onclick="deleteChat(event, '${chat.id}')" title="Xóa">
                <i data-lucide="trash-2" size="14"></i>
            </button>
        `;
        item.onclick = () => switchChat(chat.id);
        historyList.appendChild(item);
    });
    lucide.createIcons();
}

async function switchChat(id) {
    currentChatId = id;
    const chat = chats.find(c => c.id === id);
    if(chat) document.getElementById('chatTitle').innerText = chat.title;
    const container = document.getElementById('chatContainer');
    container.innerHTML = '';
    
    try {
        const response = await fetch(`/api/chats/${id}/messages`);
        currentMessages = await response.json();
        
        if (currentMessages.length === 0) {
             showWelcome();
        } else {
            currentMessages.forEach(msg => appendMessage(msg.role, msg.content, false));
        }
        renderHistory();
        lucide.createIcons();
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

function showWelcome() {
    document.getElementById('chatContainer').innerHTML = `
        <div class="message assistant">
            <div class="avatar"><i data-lucide="bot" color="white" size="20"></i></div>
            <div class="message-content">Chào bạn! Hãy chọn hoặc tạo chat mới. Sẵn sàng trả lời câu hỏi của bạn.</div>
        </div>
    `;
    document.getElementById('chatTitle').innerText = 'AI Assistant';
    lucide.createIcons();
}

async function deleteChat(event, id) {
    event.stopPropagation();
    if (!confirm('Bạn có chắc muốn xóa đoạn hội thoại này?')) return;
    
    try {
        await fetch(`/api/chats/${id}`, { method: 'DELETE' });
        chats = chats.filter(c => c.id !== id);
        
        if (currentChatId === id) {
            currentChatId = null;
            currentMessages = [];
            showWelcome();
        }
        renderHistory();
    } catch (error) {
        console.error('Failed to delete chat:', error);
    }
}

function appendMessage(role, content, saveToLocalList = true) {
    const container = document.getElementById('chatContainer');
    const msgDiv = document.createElement('div');
    const cssRole = role === 'assistant' ? 'assistant' : role;
    msgDiv.className = `message ${cssRole}`;
    
    const icon = role === 'user' ? 'user' : 'bot';
    msgDiv.innerHTML = `
        <div class="avatar"><i data-lucide="${icon}" color="white" size="20"></i></div>
        <div class="message-content">${marked.parse(content)}</div>
    `;
    
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
    
    msgDiv.querySelectorAll('pre code').forEach(block => {
        hljs.highlightElement(block);
    });

    lucide.createIcons();

    if (saveToLocalList) {
        currentMessages.push({ role, content });
    }
}

async function sendMessage() {
    const input = document.getElementById('userInput');
    const btn = document.getElementById('sendBtn');
    const content = input.value.trim();
    const key = apiKeyInput.value.trim();

    if (!content || btn.disabled) return;

    input.value = '';
    input.style.height = 'auto';
    
    if (!currentChatId) {
        await createNewChat();
    }
    
    appendMessage('user', content);

    // Save to DB
    try {
        await fetch(`/api/chats/${currentChatId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'user', content })
        });
        
        // Update local chat title if it's the first message
        if (currentMessages.length === 1) {
             const chat = chats.find(c => c.id === currentChatId);
             if (chat) {
                 chat.title = content.substring(0, 25) + (content.length > 25 ? '...' : '');
                 document.getElementById('chatTitle').innerText = chat.title;
                 renderHistory();
             }
        }
    } catch (error) {
        console.error('Failed to save message to DB:', error);
    }

    const container = document.getElementById('chatContainer');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant loading';
    loadingDiv.innerHTML = `
        <div class="avatar"><i data-lucide="bot" color="white" size="20"></i></div>
        <div class="message-content"><div class="typing"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>
    `;
    container.appendChild(loadingDiv);
    container.scrollTop = container.scrollHeight;
    lucide.createIcons();

    btn.disabled = true;

    try {
        const systemPrompt = { role: 'system', content: 'Bạn là một trợ lý AI thông minh. Yêu cầu bắt buộc: Luôn luôn trả lời bằng tiếng Việt chuẩn, đúng chính tả tuyệt đối, văn phong tự nhiên, thân thiện và dễ hiểu.' };
        const messagesToSend = [systemPrompt, ...currentMessages];

        const response = await fetch("/api/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": document.getElementById('modelSelect').value,
                "messages": messagesToSend,
                "apiKey": key
            })
        });

        const data = await response.json();
        if (container.contains(loadingDiv)) container.removeChild(loadingDiv);

        if (data.choices && data.choices[0]) {
            const reply = data.choices[0].message.content;
            appendMessage('assistant', reply);
            
            // Save bot reply to DB
            await fetch(`/api/chats/${currentChatId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: 'assistant', content: reply })
            });
            
        } else if (data.error) {
            let errorMsg = data.error.message || "Lỗi không xác định từ model.";
            if (errorMsg.includes("Provider returned error")) {
                errorMsg = "Model này hiện đang bận hoặc gặp lỗi (Provider error). Vui lòng thử đổi sang model khác trong danh sách!";
            }
            appendMessage('assistant', "Lỗi: " + errorMsg, false); // Don't save to array
        } else {
            appendMessage('assistant', "Không nhận được phản hồi. Thử đổi model khác!", false);
        }
    } catch (error) {
        if (container.contains(loadingDiv)) container.removeChild(loadingDiv);
        appendMessage('assistant', "Đã xảy ra lỗi kết nối. Hãy kiểm tra Backend hoặc mạng.", false);
        console.error(error);
    } finally {
        btn.disabled = false;
        userInput.focus();
    }
}

// Handle Enter key properly
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Initialize on load
document.addEventListener('DOMContentLoaded', loadChats);
