import http from 'http';
import net from 'net';
import httpProxy from 'http-proxy';

const PORT = 8080;

// Valid access tokens (in real implementation, this should be in a secure database)
const VALID_TOKENS = new Set([
    'your-secret-token-1',
    'your-secret-token-2'
]);

// Define allowed domains
const ALLOWED_DOMAINS = [
    'twitter.com',
    'x.com',
    'api.twitter.com',
    'pbs.twimg.com',
    'video.twimg.com',
];

// Helper function to check if domain should be proxied
function shouldProxy(hostname) {
    return ALLOWED_DOMAINS.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
    );
}

// Verify access token
function isValidToken(token) {
    return VALID_TOKENS.has(token);
}

// Extract token from headers
function extractToken(headers) {
    const authHeader = headers['proxy-authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    return token;
}

const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    xfwd: true,
    secure: false,
    proxyTimeout: 30000,
    timeout: 30000
});

proxy.on('error', (err, req, res) => {
    console.error('[PROXY ERROR]', {
        error: err.message,
        url: req?.url,
        headers: req?.headers,
        stack: err.stack
    });
    
    if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Proxy error: ' + err.message);
    }
});

const server = http.createServer((req, res) => {
    try {
        // Check authentication
        const token = extractToken(req.headers);
        if (!isValidToken(token)) {
            console.log('[AUTH ERROR] Invalid token:', token);
            res.writeHead(407, {
                'Content-Type': 'text/plain',
                'Proxy-Authenticate': 'Bearer realm="Proxy"'
            });
            res.end('Proxy authentication required');
            return;
        }

        const targetUrl = req.url.startsWith('http') ? req.url : `http://${req.headers.host}${req.url}`;
        const targetHostname = new URL(targetUrl).hostname;

        console.log('[HTTP REQUEST]', {
            url: targetUrl,
            hostname: targetHostname,
            method: req.method,
            shouldBeProxied: shouldProxy(targetHostname)
        });

        if (!shouldProxy(targetHostname)) {
            console.log('[DIRECT CONNECTION]', targetHostname);
            res.writeHead(502, { 'Content-Type': 'text/plain' });
            res.end('Direct connection not allowed through proxy');
            return;
        }

        if (req.method === 'OPTIONS') {
            res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400'
            });
            return res.end();
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        proxy.web(req, res, { 
            target: targetUrl,
            secure: false,
            followRedirects: true,
            changeOrigin: true
        });
    } catch (error) {
        console.error('[SERVER ERROR]', error);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error: ' + error.message);
    }
});

server.on('connect', (req, clientSocket, head) => {
    try {
        // Check authentication for HTTPS connections
        const token = extractToken(req.headers);
        if (!isValidToken(token)) {
            console.log('[AUTH ERROR] Invalid token for HTTPS:', token);
            clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n' +
                             'Proxy-Authenticate: Bearer realm="Proxy"\r\n' +
                             '\r\n');
            clientSocket.end();
            return;
        }

        const [targetHost, targetPortStr] = req.url.split(':');
        const port = parseInt(targetPortStr) || 443;

        console.log('[HTTPS CONNECT]', {
            host: targetHost,
            port: port,
            shouldBeProxied: shouldProxy(targetHost)
        });

        if (!shouldProxy(targetHost)) {
            console.log('[DIRECT HTTPS]', targetHost);
            clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            return;
        }

        const targetSocket = net.connect(port, targetHost, () => {
            console.log('[TUNNEL CONNECTED]', req.url);
            
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                             'Proxy-agent: Node.js-Proxy\r\n' +
                             '\r\n');

            targetSocket.pipe(clientSocket);
            clientSocket.pipe(targetSocket);
        });

        targetSocket.on('error', (err) => {
            console.error('[TUNNEL ERROR]', {
                error: err.message,
                target: req.url
            });
            clientSocket.end();
        });

        clientSocket.on('error', (err) => {
            console.error('[CLIENT ERROR]', {
                error: err.message,
                target: req.url
            });
            targetSocket.end();
        });

        targetSocket.on('end', () => {
            console.log('[TUNNEL END]', req.url);
            clientSocket.end();
        });

        clientSocket.on('end', () => {
            console.log('[CLIENT END]', req.url);
            targetSocket.end();
        });
    } catch (error) {
        console.error('[CONNECT ERROR]', error);
        clientSocket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER STARTED] Proxy server running on http://0.0.0.0:${PORT}`);
    console.log('[ALLOWED DOMAINS]', ALLOWED_DOMAINS);
});

server.on('error', (err) => {
    console.error('[SERVER ERROR]', err);
});

process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]', reason);
});