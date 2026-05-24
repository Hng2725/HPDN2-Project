# ChatGPT Fake

Giao diện chat giả lập ChatGPT, dùng OpenRouter API làm backend proxy, lưu lịch sử hội thoại bằng SQLite.

## Tech Stack

- **Backend**: Node.js + Express
- **AI**: OpenRouter API (Gemini, GPT, ...)
- **Database**: SQLite
- **Frontend**: HTML/CSS/JS thuần

## Cài đặt

```bash
npm install
```

Tạo file `.env`:

```env
OPENROUTER_API_KEY=your_api_key_here
```

## Chạy

```bash
npm start        # production
npm run dev      # development (auto-reload)
```

Truy cập: `http://localhost:3000`
