import http from 'http';
import https from 'https';
import httpProxy from 'http-proxy';
import url from 'url';

const PORT = 8080;
const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    xfwd: true,
    secure: false
});

// Detailed error logging for proxy events
proxy.on('error', (err, req, res) => {
    console.error('[PROXY ERROR] Proxy error:', err.message);
    console.error('[PROXY ERROR] URL:', req.url);
    console.error('[PROXY ERROR] Headers:', req.headers);
    console.error('[PROXY ERROR] Stack:', err.stack);
    
    if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Proxy error: ' + err.message);
    }
});

proxy.on('proxyReq', (proxyReq, req, res, options) => {
    console.log('[PROXY REQUEST]', {
        url: req.url,
        method: req.method,
        headers: proxyReq.getHeaders(),
        target: options.target
    });
});

proxy.on('proxyRes', (proxyRes, req, res) => {
    console.log('[PROXY RESPONSE]', {
        url: req.url,
        statusCode: proxyRes.statusCode,
        headers: proxyRes.headers
    });
});

const server = http.createServer((req, res) => {
    console.log(`[HTTP REQUEST] Incoming request:`, {
        url: req.url,
        method: req.method,
        headers: req.headers
    });

    try {
        // Parse the target URL
        const targetUrl = req.url.startsWith('http') ? req.url : `http://${req.headers.host}${req.url}`;
        console.log('[HTTP REQUEST] Target URL:', targetUrl);

        // Set required headers
        req.headers['x-forwarded-for'] = req.connection.remoteAddress;
        delete req.headers['origin']; // Remove origin to avoid CORS issues

        proxy.web(req, res, { 
            target: targetUrl,
            secure: false,
            followRedirects: true
        }, (err) => {
            console.error('[HTTP ERROR] Proxy error:', err);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Proxy error: ' + err.message);
            }
        });
    } catch (error) {
        console.error('[HTTP ERROR] Server error:', error);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Server error: ' + error.message);
        }
    }
});

// Enhanced HTTPS handling
server.on('connect', (req, socket, head) => {
    console.log('[HTTPS CONNECT] New CONNECT request:', {
        url: req.url,
        method: req.method,
        headers: req.headers
    });

    try {
        const [hostname, port = '443'] = req.url.split(':');
        console.log('[HTTPS CONNECT] Parsed target:', { hostname, port });

        const options = {
            port: parseInt(port),
            host: hostname,
            connectTimeout: 10000
        };

        const proxySocket = new Promise((resolve, reject) => {
            const conn = https.request(options)
                .on('connect', (res, socket) => resolve(socket))
                .on('error', reject)
                .end();
        });

        proxySocket.then(targetSocket => {
            console.log('[HTTPS CONNECT] Connection established');
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            
            targetSocket.pipe(socket);
            socket.pipe(targetSocket);

            targetSocket.on('error', (err) => {
                console.error('[HTTPS ERROR] Target socket error:', err);
                socket.end();
            });

            socket.on('error', (err) => {
                console.error('[HTTPS ERROR] Client socket error:', err);
                targetSocket.end();
            });

        }).catch(err => {
            console.error('[HTTPS ERROR] Connection failed:', err);
            socket.end();
        });

    } catch (error) {
        console.error('[HTTPS ERROR] CONNECT handling error:', error);
        socket.end();
    }
});

server.listen(PORT, () => {
    console.log(`[SERVER] Proxy server running on http://localhost:${PORT}`);
});

// Handle server errors
server.on('error', (err) => {
    console.error('[SERVER ERROR] Server error:', err);
});

process.on('uncaughtException', (err) => {
    console.error('[PROCESS ERROR] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[PROCESS ERROR] Unhandled rejection:', reason);
});