import http from 'http';
import net from 'net';
import httpProxy from 'http-proxy';

const PORT = 8080;

// Define valid access tokens (in production, use a secure database)
const VALID_TOKENS = new Set([
    'token123',
    'token456'
]);

// Define allowed domains
const ALLOWED_DOMAINS = [
    'twitter.com',
    'x.com',
    'api.twitter.com',
    'pbs.twimg.com',
    'video.twimg.com',
    'https://whatismyipaddress.com/'
];

// Helper function to check if domain should be proxied
function shouldProxy(hostname) {
    return ALLOWED_DOMAINS.some(domain => 
        hostname === domain || hostname.endsWith('.' + domain)
    );
}

// Helper function to extract and validate basic auth credentials
function extractBasicAuth(headers) {
    const authHeader = headers['proxy-authorization'] || '';
    if (authHeader.startsWith('Basic ')) {
        const encodedCreds = authHeader.slice(6);
        const decodedCreds = Buffer.from(encodedCreds, 'base64').toString('utf-8');
        const [username, password] = decodedCreds.split(':');
        return { username, password };
    }
    return null;
}

// Validate authentication
function isValidAuth(headers) {
    const creds = extractBasicAuth(headers);
    if (!creds) {
        console.log('[AUTH] No credentials provided');
        return false;
    }
    
    const isValid = VALID_TOKENS.has(creds.username);
    console.log('[AUTH] Token validation:', { 
        username: creds.username,
        isValid: isValid 
    });
    return isValid;
}

// Create proxy server
const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    xfwd: true,
    secure: false,
    proxyTimeout: 30000,
    timeout: 30000
});

// Proxy error handling
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

// Log proxy events
proxy.on('proxyReq', (proxyReq, req, res, options) => {
    console.log('[PROXY REQUEST]', {
        url: req.url,
        method: req.method,
        headers: proxyReq.getHeaders()
    });
});

proxy.on('proxyRes', (proxyRes, req, res) => {
    console.log('[PROXY RESPONSE]', {
        url: req.url,
        status: proxyRes.statusCode,
        headers: proxyRes.headers
    });
});

// Create server
const server = http.createServer((req, res) => {
    console.log('[HTTP REQUEST]', {
        url: req.url,
        method: req.method,
        headers: req.headers
    });

    // Check authentication
    if (!isValidAuth(req.headers)) {
        res.writeHead(407, {
            'Content-Type': 'text/plain',
            'Proxy-Authenticate': 'Basic realm="Proxy"'
        });
        res.end('Proxy authentication required');
        return;
    }

    try {
        const targetUrl = req.url.startsWith('http') ? req.url : `http://${req.headers.host}${req.url}`;
        const targetHostname = new URL(targetUrl).hostname;

        console.log('[TARGET]', {
            url: targetUrl,
            hostname: targetHostname,
            shouldBeProxied: shouldProxy(targetHostname)
        });

        // Check if domain is allowed
        if (!shouldProxy(targetHostname)) {
            console.log('[BLOCKED] Domain not allowed:', targetHostname);
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Domain not allowed');
            return;
        }

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(200, {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
                'Access-Control-Allow-Headers': '*',
                'Access-Control-Max-Age': '86400'
            });
            return res.end();
        }

        // Set CORS headers for all responses
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');

        // Forward the request
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

// Handle CONNECT for HTTPS
server.on('connect', (req, clientSocket, head) => {
    console.log('[HTTPS CONNECT]', {
        url: req.url,
        method: req.method,
        headers: req.headers
    });

    // Check authentication
    if (!isValidAuth(req.headers)) {
        console.log('[AUTH ERROR] Invalid credentials for HTTPS');
        clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n' +
                         'Proxy-Authenticate: Basic realm="Proxy"\r\n' +
                         '\r\n');
        clientSocket.end();
        return;
    }

    try {
        // Parse the target
        const [targetHost, targetPortStr] = req.url.split(':');
        const port = parseInt(targetPortStr) || 443;

        console.log('[TUNNEL TARGET]', {
            host: targetHost,
            port: port,
            shouldBeProxied: shouldProxy(targetHost)
        });

        // Check if domain is allowed
        if (!shouldProxy(targetHost)) {
            console.log('[BLOCKED] HTTPS domain not allowed:', targetHost);
            clientSocket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
            return;
        }

        // Create connection to target
        const targetSocket = net.connect(port, targetHost, () => {
            console.log('[TUNNEL CONNECTED]', req.url);
            
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                             'Proxy-agent: Node.js-Proxy\r\n' +
                             '\r\n');

            targetSocket.pipe(clientSocket);
            clientSocket.pipe(targetSocket);
        });

        // Handle target connection errors
        targetSocket.on('error', (err) => {
            console.error('[TUNNEL ERROR]', {
                error: err.message,
                target: req.url
            });
            clientSocket.end();
        });

        // Handle client connection errors
        clientSocket.on('error', (err) => {
            console.error('[CLIENT ERROR]', {
                error: err.message,
                target: req.url
            });
            targetSocket.end();
        });

        // Clean up on connection end
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

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER STARTED] Proxy server running on http://0.0.0.0:${PORT}`);
    console.log('[ALLOWED DOMAINS]', ALLOWED_DOMAINS);
});

// Global error handlers
server.on('error', (err) => {
    console.error('[SERVER ERROR]', err);
});

process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]', reason);
});