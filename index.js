import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import basicAuth from "basic-auth";
import cors from "cors";
import { createServer } from "http";

const PROXY_PORT = 8080;
const AUTH_USER = "proxyuser";
const AUTH_PASS = "strongpassword";
const ALLOWED_WEBSITES = [
    "twitter.com",
    "api.twitter.com",
    "linkedin.com",
    "facebook.com"
];

const app = express();
app.use(cors());

// Authentication Middleware
const authMiddleware = (req, res, next) => {
    const user = basicAuth(req);
    if (!user || user.name !== AUTH_USER || user.pass !== AUTH_PASS) {
        res.set("WWW-Authenticate", 'Basic realm="Proxy"');
        return res.status(401).send("Access denied");
    }
    next();
};

// Proxy Middleware
const proxyMiddleware = createProxyMiddleware({
    target: "https://twitter.com", // Default target (dynamic per request)
    changeOrigin: true,
    selfHandleResponse: false,
    onProxyReq: (proxyReq, req, res) => {
        const targetHost = req.headers.host;

        // Allow only whitelisted websites
        if (!ALLOWED_WEBSITES.some(site => targetHost.includes(site))) {
            res.status(403).send("Access to this website is not allowed.");
            return;
        }

        // Simulate a real browser (Headers)
        proxyReq.setHeader("User-Agent", "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/109.0");
        proxyReq.setHeader("Referer", `https://${targetHost}/`);
    },
    onError: (err, req, res) => {
        res.status(500).send("Proxy error: " + err.message);
    },
});

// Apply Authentication and Proxy
// app.use(authMiddleware);
app.use("/", proxyMiddleware);

// Start the proxy server
const server = createServer(app);
server.listen(PROXY_PORT, () => {
    console.log(`Secure forward proxy running on port ${PROXY_PORT}`);
});
