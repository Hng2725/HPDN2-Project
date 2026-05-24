require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Get all chats
app.get('/api/chats', (req, res) => {
    db.all('SELECT * FROM chats ORDER BY created_at DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Create a new chat
app.post('/api/chats', (req, res) => {
    const { id, title } = req.body;
    db.run('INSERT INTO chats (id, title) VALUES (?, ?)', [id, title], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id, title });
    });
});

// Delete a chat
app.delete('/api/chats/:id', (req, res) => {
    const { id } = req.params;
    db.run('DELETE FROM chats WHERE id = ?', [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

// Get messages for a chat
app.get('/api/chats/:id/messages', (req, res) => {
    const { id } = req.params;
    db.all('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id ASC', [id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add a message to a chat
app.post('/api/chats/:id/messages', (req, res) => {
    const { id } = req.params;
    const { role, content } = req.body;
    
    // Check if this is the first user message to update chat title
    if (role === 'user') {
        db.get('SELECT COUNT(*) as count FROM messages WHERE chat_id = ?', [id], (err, row) => {
            if (!err && row.count === 0) {
                const newTitle = content.substring(0, 25) + (content.length > 25 ? '...' : '');
                db.run('UPDATE chats SET title = ? WHERE id = ?', [newTitle, id]);
            }
            insertMessage();
        });
    } else {
        insertMessage();
    }

    function insertMessage() {
        db.run('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)', [id, role, content], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, role, content });
        });
    }
});

// Proxy to OpenRouter API
app.post('/api/chat/completions', async (req, res) => {
    try {
        const { model, messages, apiKey } = req.body;
        // Use client key if provided, else use env key
        const openRouterKey = apiKey || process.env.OPENROUTER_API_KEY;
        
        if (!openRouterKey) {
            return res.status(400).json({ error: { message: "API Key is required" } });
        }

        const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            model,
            messages
        }, {
            headers: {
                "Authorization": `Bearer ${openRouterKey}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "Local ChatGPT Clone"
            }
        });

        res.json(response.data);
    } catch (error) {
        console.error('API proxy error:', error.response ? error.response.data : error.message);
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: { message: "Internal server error connecting to OpenRouter" } });
        }
    }
});

// Fallback to index.html for SPA
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
