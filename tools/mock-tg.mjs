// خادم تيليجرام وهمي للاختبار المحلي: يسجل الاستدعاءات ويخدم ملفات.
import http from 'node:http';
import { readFileSync } from 'node:fs';
const PORT = Number(process.env.PORT || 8790);
const calls = [];
const files = { 'FILEID_voice_0123456789abcdef': 'voice/file_1.oga', 'FILEID_photo_0123456789abcdef': 'photos/file_2.jpg' };
const fileData = { 'voice/file_1.oga': process.env.OGG, 'photos/file_2.jpg': process.env.JPG };
let mid = 100;
http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
      if (req.url === '/__calls') {
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify(calls));
      }
      const f = /^\/file\/bot[^/]+\/(.+)$/.exec(req.url);
      if (f) {
        const path = fileData[f[1]];
        if (!path) return res.writeHead(404).end();
        const data = readFileSync(path);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': data.length });
        return res.end(data);
      }
      if (!m) return res.writeHead(404).end();
      const method = m[2];
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch {}
      calls.push({ method, payload });
      let result = true;
      if (method === 'getMe') result = { id: 777, is_bot: true, first_name: 'قلّدها', username: 'qallidha_test_bot' };
      if (method === 'sendMessage') result = { message_id: ++mid, chat: { id: payload.chat_id }, text: payload.text };
      if (method === 'getFile') {
        const p = files[payload.file_id];
        if (!p) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: invalid file_id' })); }
        result = { file_id: payload.file_id, file_unique_id: 'u', file_size: 1000, file_path: p };
      }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, result }));
    });
  })
  .listen(PORT, '127.0.0.1', () => console.log('mock tg on', PORT));
