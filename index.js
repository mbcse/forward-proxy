import http from 'http';
import httpProxy from 'http-proxy';

const PORT = 8080;
const proxy = httpProxy.createProxyServer({ changeOrigin: true });

const server = http.createServer((req, res) => {
    console.log(`[PROXY] Request for: ${req.url}`);

    // Modify headers to avoid CORS issues
    req.headers['origin'] = null;

    proxy.web(req, res, { target: req.url, secure: false }, (err) => {
        console.error('[PROXY ERROR]', err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Proxy error');
    });
});

// Handle HTTPS requests (important for Twitter & WhatIsMyIPAddress)
server.on('connect', (req, socket) => {
    console.log(`[HTTPS PROXY] Handling CONNECT for: ${req.url}`);

    const serverUrl = req.url.split(':');
    const hostname = serverUrl[0];
    const port = parseInt(serverUrl[1]) || 443;

    const net = require('net');
    const proxySocket = net.connect(port, hostname, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
    });

    proxySocket.on('error', (err) => {
        console.error(`[HTTPS ERROR] ${err}`);
        socket.end();
    });
});

server.listen(PORT, () => {
    console.log(`[PROXY] Server running on http://localhost:${PORT}`);
});
