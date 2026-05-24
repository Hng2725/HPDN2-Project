/**
 * server.js — ChatGPT Fake Backend
 * Express server + SQLite + OpenRouter API Proxy
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const axios   = require('axios');
const db      = require('./database');

const app  = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ────────────────────────────────────
// CHAT CRUD ROUTES
// ────────────────────────────────────

/** GET /api/chats — Lấy tất cả chat, sắp xếp mới nhất trước */
app.get('/api/chats', (req, res) => {
    db.all('SELECT * FROM chats ORDER BY created_at DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

/** POST /api/chats — Tạo chat mới */
app.post('/api/chats', (req, res) => {
    const { id, title } = req.body;
    if (!id || !title) {
        return res.status(400).json({ error: 'id và title là bắt buộc' });
    }
    db.run('INSERT INTO chats (id, title) VALUES (?, ?)', [id, title], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id, title });
    });
});

/** DELETE /api/chats/:id — Xóa chat theo ID */
app.delete('/api/chats/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM chats WHERE id = ?', [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Chat không tồn tại' });
        res.json({ deleted: this.changes });
    });
});

// ────────────────────────────────────
// MESSAGES ROUTES
// ────────────────────────────────────

/** GET /api/chats/:id/messages — Lấy tất cả messages của một chat */
app.get('/api/chats/:id/messages', (req, res) => {
    const { id } = req.params;
    db.all(
        'SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC',
        [id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

/** POST /api/chats/:id/messages — Thêm message và cập nhật title nếu là tin đầu tiên */
app.post('/api/chats/:id/messages', (req, res) => {
    const { id } = req.params;
    const { role, content } = req.body;

    if (!role || !content) {
        return res.status(400).json({ error: 'role và content là bắt buộc' });
    }
    if (!['user', 'assistant', 'system'].includes(role)) {
        return res.status(400).json({ error: 'role không hợp lệ' });
    }

    // Nếu là tin nhắn user đầu tiên → cập nhật title
    if (role === 'user') {
        db.get('SELECT COUNT(*) as count FROM messages WHERE chat_id = ?', [id], (err, row) => {
            if (!err && row.count === 0) {
                const newTitle = content.substring(0, 30) + (content.length > 30 ? '…' : '');
                db.run('UPDATE chats SET title = ? WHERE id = ?', [newTitle, id]);
            }
            insertMessage();
        });
    } else {
        insertMessage();
    }

    function insertMessage() {
        db.run(
            'INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)',
            [id, role, content],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.status(201).json({ id: this.lastID, role, content });
            }
        );
    }
});

// ────────────────────────────────────
// OPENROUTER API PROXY
// ────────────────────────────────────

/** POST /api/chat/completions — Proxy streaming tới OpenRouter */
app.post('/api/chat/completions', async (req, res) => {
    const { model, messages, apiKey } = req.body;

    if (!model || !messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: { message: 'model và messages là bắt buộc' } });
    }

    const openRouterKey = apiKey || process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
        return res.status(400).json({ error: { message: 'API Key là bắt buộc.' } });
    }

    try {
        // Gửi request với stream: true tới OpenRouter
        const response = await axios.post(
            `${OPENROUTER_BASE}/chat/completions`,
            { model, messages, stream: true },
            {
                headers: {
                    'Authorization': `Bearer ${openRouterKey}`,
                    'Content-Type':  'application/json',
                    'HTTP-Referer':  process.env.SITE_URL || 'http://localhost:3000',
                    'X-Title':       'ChatGPT Fake - Local Dev'
                },
                responseType: 'stream',
                timeout: 30000
            }
        );

        // Set headers SSE để client nhận stream
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Pipe stream từ OpenRouter → client
        response.data.on('data', (chunk) => {
            res.write(chunk);
        });
        response.data.on('end', () => {
            res.end();
        });
        response.data.on('error', (err) => {
            console.error('[Stream] Error:', err.message);
            res.end();
        });

    } catch (err) {
        if (err.response) {
            // Nếu lỗi trả về trước khi stream bắt đầu
            let errData = '';
            err.response.data.on('data', c => errData += c);
            err.response.data.on('end', () => {
                try {
                    const parsed = JSON.parse(errData);
                    console.error('[API Proxy] OpenRouter error:', err.response.status, JSON.stringify(parsed));
                    res.status(err.response.status).json(parsed);
                } catch {
                    res.status(500).json({ error: { message: errData || 'Lỗi không xác định' } });
                }
            });
        } else if (err.code === 'ECONNABORTED') {
            console.error('[API Proxy] Timeout');
            res.status(504).json({ error: { message: 'Request timeout. Thử lại.' } });
        } else {
            console.error('[API Proxy] Network error:', err.message);
            res.status(500).json({ error: { message: 'Lỗi kết nối tới OpenRouter.' } });
        }
    }
});

// ────────────────────────────────────
// FALLBACK — SPA
// ────────────────────────────────────
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// ────────────────────────────────────
// START SERVER
// ────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Server running at http://localhost:${PORT}`);
    console.log(`   Mode: ${process.env.NODE_ENV || 'development'}`);
});
