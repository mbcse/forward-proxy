import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import morgan from "morgan";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 8080;
const ALLOWED_SITES = ["https://twitter.com", "https://whatismyipaddress.com"];

// 📌 Rate Limiting to prevent abuse
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per 15 minutes
    message: "Too many requests, slow down!",
});

app.use(morgan("tiny")); // Logging middleware
app.use(limiter); // Apply rate limiting

// 📌 Middleware to create a proxy
const setupProxy = (target) => {
    return createProxyMiddleware({
        target,
        changeOrigin: true,
        ws: true,
        onProxyReq: (proxyReq, req, res) => {
            // 🔒 Remove headers that reveal proxy usage
            proxyReq.removeHeader("X-Forwarded-For");
            proxyReq.removeHeader("Via");
            proxyReq.removeHeader("Forwarded");
        },
        pathRewrite: (path, req) => path.replace(/^\/proxy/, ""), // Remove "/proxy" prefix
        onError: (err, req, res) => {
            res.status(500).json({ error: "Proxy error", details: err.message });
        },
    });
};

// 📌 Set up proxy routes
app.use("/twitter", setupProxy("https://twitter.com"));
app.use("/myip", setupProxy("https://whatismyipaddress.com"));

// 📌 Start the server
app.listen(PORT, () => {
    console.log(`🚀 Proxy server running at http://0.0.0.0:${PORT}`);
});
