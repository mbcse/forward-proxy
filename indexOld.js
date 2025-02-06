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

class BrowserManager {
    constructor() {
        this.browser = null;
        this.page = null;
        this.isConnected = false;
        this.retryCount = 0;
        this.maxRetries = 3;
    }

    async findChromePath() {
        const CHROME_PATHS = [
            "/usr/bin/chromium-browser",
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
        ];

        for (const path of CHROME_PATHS) {
            try {
                await fs.promises.access(path);
                console.log('Found Chrome at:', path);
                return path;
            } catch (error) {
                console.log(`Chrome not found at: ${path}`);
            }
        }
        throw new Error('Could not find Chrome installation');
    }

    async initBrowser() {
        try {
            const chromePath = await this.findChromePath();
            
            this.browser = await puppeteer.launch({
                headless: true,  // Use headed mode for more stability
                executablePath: chromePath,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--window-size=1280,800'
                ]
            });

            this.page = await this.browser.newPage();
            await this.setupPage();
            this.isConnected = true;
            this.retryCount = 0;
            
            // Monitor browser connection
            this.browser.on('disconnected', () => {
                console.log('Browser disconnected');
                this.isConnected = false;
                this.handleDisconnect();
            });

            return true;
        } catch (error) {
            console.error('Browser init error:', error);
            return false;
        }
    }

    async setupPage() {
        await this.page.setViewport({ width: 1280, height: 800 });
        await this.page.setDefaultNavigationTimeout(30000);
        
        // Handle page errors
        this.page.on('error', error => {
            console.error('Page error:', error);
            this.handleDisconnect();
        });

        // Setup request interception
        await this.page.setRequestInterception(true);
        this.page.on('request', request => {
            request.continue({
                headers: {
                    ...request.headers(),
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
        });

        await this.page.goto('https://twitter.com/login', {
            waitUntil: 'networkidle0',
            timeout: 30000
        });
    }

    async handleClick(x, y) {
        if (!this.isConnected || !this.page) {
            throw new Error('Browser not connected');
        }

        try {
            // Move mouse to position first
            await this.page.mouse.move(x, y);
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Perform click
            await this.page.mouse.down();
            await new Promise(resolve => setTimeout(resolve, 100));
            await this.page.mouse.up();
            
            // Wait for potential navigation
            await Promise.race([
                this.page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {}),
                new Promise(resolve => setTimeout(resolve, 2000))
            ]);
        } catch (error) {
            console.error('Click error:', error);
            if (error.message.includes('Target closed')) {
                await this.handleDisconnect();
            }
            throw error;
        }
    }

    async handleKeyboard(text) {
        if (!this.isConnected || !this.page) {
            throw new Error('Browser not connected');
        }

        try {
            await this.page.keyboard.type(text, { delay: 100 });
        } catch (error) {
            console.error('Keyboard error:', error);
            if (error.message.includes('Target closed')) {
                await this.handleDisconnect();
            }
            throw error;
        }
    }

    async handleDisconnect() {
        this.isConnected = false;
        
        if (this.retryCount < this.maxRetries) {
            console.log(`Attempting to reconnect (attempt ${this.retryCount + 1}/${this.maxRetries})`);
            this.retryCount++;
            await this.cleanup();
            return await this.initBrowser();
        } else {
            console.log('Max retry attempts reached');
            return false;
        }
    }

    async cleanup() {
        if (this.browser) {
            try {
                await this.browser.close();
            } catch (error) {
                console.error('Cleanup error:', error);
            }
        }
        this.browser = null;
        this.page = null;
        this.isConnected = false;
    }

    async captureScreenshot() {
        if (!this.isConnected || !this.page) {
            throw new Error('Browser not connected');
        }

        try {
            return await this.page.screenshot({
                type: 'jpeg',
                quality: 80
            });
        } catch (error) {
            console.error('Screenshot error:', error);
            if (error.message.includes('Target closed')) {
                await this.handleDisconnect();
            }
            throw error;
        }
    }
}

const browserManager = new BrowserManager();

io.on('connection', (socket) => {
    console.log('Client connected');
    let streamInterval;

    socket.on('start-session', async () => {
        try {
            if (streamInterval) {
                clearInterval(streamInterval);
            }

            const success = await browserManager.initBrowser();
            
            if (success) {
                streamInterval = setInterval(async () => {
                    try {
                        const screenshot = await browserManager.captureScreenshot();
                        socket.emit('page-update', screenshot);
                    } catch (err) {
                        clearInterval(streamInterval);
                        socket.emit('error', 'Screenshot failed');
                    }
                }, 1000/30);
            } else {
                socket.emit('error', 'Failed to start browser');
            }
        } catch (error) {
            console.error('Session error:', error);
            socket.emit('error', error.message);
        }
    });

    socket.on('action', async ({ type, x, y, text }) => {
        try {
            switch (type) {
                case 'click':
                    await browserManager.handleClick(x, y);
                    break;
                case 'type':
                    await browserManager.handleKeyboard(text);
                    break;
            }
        } catch (error) {
            console.error('Action error:', error);
            socket.emit('error', 'Action failed');
        }
    });

    socket.on('disconnect', async () => {
        console.log('Client disconnected');
        if (streamInterval) {
            clearInterval(streamInterval);
        }
        await browserManager.cleanup();
    });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});