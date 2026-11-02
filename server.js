const http = require('http');
const fs = require('fs');
const path = require('path');
const gameHandler = require('./api/game.js');

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/game') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      req.body = body;
      res.status = (code) => { res.statusCode = code; return res; };
      res.json = (obj) => { res.end(JSON.stringify(obj)); };
      gameHandler(req, res);
    });
    return;
  }

  let filePath = path.join(__dirname, 'public', url === '/' ? 'index.html' : (url === '/admin' ? 'admin.html' : url));
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'public', 'index.html');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(filePath));
});

let port = Number(process.env.PORT) || 3000;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    port += 1;
    server.listen(port);
  }
});
server.on('listening', () => {
  console.log(`\n✅ Local Game Server:  http://localhost:${port}`);
  console.log(`✅ Local Admin Portal: http://localhost:${port}/admin\n`);
});
server.listen(port);