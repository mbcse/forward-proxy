import http from 'http';
import net from 'net';
import httpProxy from 'http-proxy';

const PORT = 8080;

// Create a proxy server with custom agent
const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    xfwd: true,
    secure: false,
    // Increase timeouts
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

// Create server
const server = http.createServer((req, res) => {
    console.log('[HTTP REQUEST]', {
        url: req.url,
        method: req.method,
        headers: req.headers
    });

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

    try {
        const targetUrl = req.url.startsWith('http') ? req.url : `http://${req.headers.host}${req.url}`;
        console.log('[PROXY TARGET]', targetUrl);

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

    // Parse the target
    const [targetHost, targetPort] = req.url.split(':');
    const port = parseInt(targetPort) || 443;

    console.log('[TUNNEL TARGET]', {
        host: targetHost,
        port: port
    });

    // Create connection to target
    const targetSocket = net.connect(port, targetHost, () => {
        console.log('[TUNNEL CONNECTED]', req.url);
        
        // Tell the client the tunnel is established
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n' +
                         'Proxy-agent: Node.js-Proxy\r\n' +
                         '\r\n');

        // Create tunnel
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
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[SERVER STARTED] Proxy server running on http://0.0.0.0:${PORT}`);
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