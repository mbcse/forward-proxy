import express from 'express';
import puppeteer from 'puppeteer-core';
import { Server } from 'socket.io';
import http from 'http';
import fs from 'fs';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: 'http://localhost:3001',
        methods: ['GET', 'POST']
    }
});

let browser;
let page;

// Chrome paths to try
const CHROME_PATHS = [
    "/usr/bin/chromium-browser"
];

async function findChromePath() {
    for (const path of CHROME_PATHS) {
        try {
            await fs.promises.access(path);
            console.log('Found Chrome at:', path);
            return path;
        } catch (error) {
            console.log(`Chrome not found at: ${path}`);
        }
    }
    throw new Error('Could not find Chrome installation. Please install Google Chrome.');
}

async function startBrowser() {
    try {
        const chromePath = await findChromePath();
        
        browser = await puppeteer.launch({
            headless: false,
            executablePath: chromePath,
            defaultViewport: {
                width: 1280,
                height: 800
            },
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        page = await browser.newPage();
        
        // Enable request interception
        await page.setRequestInterception(true);
        
        // Handle request interception
        page.on('request', (request) => {
            // Add any required headers here
            const headers = {
                ...request.headers(),
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            };
            
            request.continue({ headers });
        });

        console.log('Navigating to Twitter login...');
        await page.goto('https://twitter.com/login', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });
        console.log('Navigation complete');

        return true;
    } catch (error) {
        console.error('Browser start error:', error);
        if (browser) {
            await browser.close();
        }
        return false;
    }
}

async function handleClick(x, y) {
    try {
        if (!page || page.isClosed()) {
            throw new Error('Page is not available');
        }
        
        await page.mouse.click(x, y);
        
        // Wait for any navigation
        try {
            await page.waitForNavigation({ 
                waitUntil: 'networkidle0',
                timeout: 5000 
            });
        } catch (error) {
            // Ignore navigation timeout - not all clicks cause navigation
        }
        
        // Wait for any potential XHR requests to complete
        await page.waitForTimeout(1000);
        
    } catch (error) {
        console.error('Click error:', error);
        throw error;
    }
}

io.on('connection', (socket) => {
    console.log('Client connected');
    let streamInterval;

    socket.on('start-session', async () => {
        try {
            console.log('Starting browser session...');
            const success = await startBrowser();
            
            if (success) {
                console.log('Browser started successfully');
                
                // Start screenshot stream
                streamInterval = setInterval(async () => {
                    try {
                        if (!page || page.isClosed()) {
                            clearInterval(streamInterval);
                            socket.emit('error', 'Page is no longer available');
                            return;
                        }

                        const screenshot = await page.screenshot({
                            type: 'jpeg',
                            quality: 75
                        });
                        socket.emit('page-update', screenshot);
                    } catch (err) {
                        console.error('Screenshot error:', err);
                        clearInterval(streamInterval);
                        socket.emit('error', 'Failed to capture page');
                    }
                }, 1000/30); // 30 FPS
            } else {
                socket.emit('error', 'Failed to start browser');
            }
        } catch (error) {
            console.error('Session error:', error);
            socket.emit('error', 'Failed to start session: ' + error.message);
        }
    });

    socket.on('action', async ({ type, x, y }) => {
        try {
            if (type === 'click') {
                await handleClick(x, y);
            }
        } catch (error) {
            console.error('Action error:', error);
            socket.emit('error', 'Failed to perform action');
        }
    });

    socket.on('disconnect', async () => {
        console.log('Client disconnected');
        if (streamInterval) {
            clearInterval(streamInterval);
        }
        if (browser) {
            await browser.close();
        }
    });
});

const PORT = process.env.PORT ||  8080;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});