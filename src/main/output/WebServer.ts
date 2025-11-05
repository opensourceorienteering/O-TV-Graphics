/**
 * Web Server for Graphics Output
 * Express server serving graphics HTML pages
 */

import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { Server as HTTPServer } from 'http';
import { marked } from 'marked';
import { getLogger } from '../utils/logger';
import { getConfig } from '../utils/config';

const logger = getLogger();
const isDev = process.env.NODE_ENV === 'development';

// Singleton instance
let webServerInstance: WebServer | null = null;

export class WebServer {
  private app: Express;
  private server: HTTPServer | null = null;
  private port: number;

  constructor(port: number) {
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();

    // Set singleton instance
    webServerInstance = this;
  }

  private setupMiddleware(): void {
    const config = getConfig();

    // CORS
    if (config.output.web.cors) {
      this.app.use(cors());
    }

    // JSON body parser
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Static files - templates and assets
    // In development: use project directory
    // In production: templates are bundled in app.asar
    const templatesPath = isDev
      ? path.join(process.cwd(), 'templates')
      : path.join(__dirname, '../../templates');

    const assetsPath = isDev
      ? path.join(process.cwd(), 'ASSETS')
      : path.join(__dirname, '../../ASSETS');

    // Serve templates with proper MIME types for ES modules
    this.app.use('/templates', express.static(templatesPath, {
      setHeaders: (res, filePath) => {
        // Ensure .js and .mjs files are served with correct MIME type for ES modules
        if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        }
      }
    }));

    // Only serve ASSETS if the directory exists (optional feature)
    if (fs.existsSync(assetsPath)) {
      this.app.use('/assets', express.static(assetsPath));
      logger.debug('Static file paths configured', {
        templatesPath,
        assetsPath,
        isDev
      });
    } else {
      logger.debug('ASSETS directory not found, skipping assets route', {
        assetsPath,
        isDev
      });
      logger.debug('Static file paths configured', {
        templatesPath,
        assetsPath: 'not found',
        isDev
      });
    }

    // Serve built renderer files in production
    if (!isDev) {
      const distPath = path.join(__dirname, '../../dist');
      if (fs.existsSync(distPath)) {
        // Serve the entire dist folder (includes assets subdirectory)
        this.app.use(express.static(distPath));
        logger.debug('Serving built renderer files from', { distPath });
      }
    }
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // Template preview page
    this.app.get('/preview', (req, res) => {
      if (isDev) {
        // In development, redirect to Vite dev server
        // Preserve the original hostname for remote access
        const host = req.get('host') || 'localhost:5657';
        const hostname = host.split(':')[0];
        const viteUrl = `http://${hostname}:5173/template-preview.html${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;
        logger.debug('Redirecting to Vite dev server for preview', { viteUrl, originalHost: host });
        res.redirect(viteUrl);
      } else {
        // In production, serve built file from dist/ directory
        // __dirname in production points to: app.asar/dist-electron/main
        // We need to go up to app.asar and then into dist/
        const htmlPath = path.join(__dirname, '../../dist/template-preview.html');

        if (fs.existsSync(htmlPath)) {
          logger.debug('Serving template preview HTML', { path: htmlPath });
          res.sendFile(htmlPath);
        } else {
          logger.error('Template preview HTML not found', { htmlPath, cwd: process.cwd(), dirname: __dirname });
          res.status(404).send('Template preview not found. Please build the application first.');
        }
      }
    });

    // Web output renderer page
    this.app.get('/output', (req, res) => {
      if (isDev) {
        // In development, redirect to Vite dev server
        // Preserve the original hostname for remote access
        const host = req.get('host') || 'localhost:5657';
        const hostname = host.split(':')[0];
        const viteUrl = `http://${hostname}:5173/web-output.html${req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : ''}`;
        logger.debug('Redirecting to Vite dev server', { viteUrl, originalHost: host });
        res.redirect(viteUrl);
      } else {
        // In production, serve built file from dist/ directory
        // __dirname in production points to: app.asar/dist-electron/main
        // We need to go up to app.asar and then into dist/
        const htmlPath = path.join(__dirname, '../../dist/web-output.html');

        if (fs.existsSync(htmlPath)) {
          logger.debug('Serving web output HTML', { path: htmlPath });
          res.sendFile(htmlPath);
        } else {
          logger.error('Web output HTML not found', { htmlPath, cwd: process.cwd(), dirname: __dirname });
          res.status(404).send('Web output not found. Please build the application first.');
        }
      }
    });

    // Web output with custom ID (for multiple instances)
    this.app.get('/output/:id', (req, res) => {
      const { id } = req.params;
      logger.debug('Web output requested with ID', { id });

      if (isDev) {
        // In development, redirect to Vite dev server with ID in query
        // Preserve the original hostname for remote access
        const host = req.get('host') || 'localhost:5657';
        const hostname = host.split(':')[0];
        const queryParams = new URLSearchParams(req.query as any);
        queryParams.set('id', id);
        const viteUrl = `http://${hostname}:5173/web-output.html?${queryParams.toString()}`;
        logger.debug('Redirecting to Vite dev server with ID', { viteUrl, originalHost: host, id });
        res.redirect(viteUrl);
      } else {
        // In production, serve built file from dist/ directory (ID will be in URL for client to read)
        // __dirname in production points to: app.asar/dist-electron/main
        // We need to go up to app.asar and then into dist/
        const htmlPath = path.join(__dirname, '../../dist/web-output.html');

        if (fs.existsSync(htmlPath)) {
          logger.debug('Serving web output HTML', { path: htmlPath });
          res.sendFile(htmlPath);
        } else {
          logger.error('Web output HTML not found', { htmlPath, cwd: process.cwd(), dirname: __dirname });
          res.status(404).send('Web output not found. Please build the application first.');
        }
      }
    });

    // Documentation viewer page
    this.app.get('/docs', (_req, res) => {
      const htmlPath = isDev
        ? path.join(process.cwd(), 'public/template-docs.html')
        : path.join(__dirname, '../../public/template-docs.html');

      if (fs.existsSync(htmlPath)) {
        logger.debug('Serving documentation page', { path: htmlPath });
        res.sendFile(htmlPath);
      } else {
        logger.error('Documentation page not found', { htmlPath });
        res.status(404).send('Documentation not found.');
      }
    });

    // Documentation content API (markdown to HTML)
    this.app.get('/docs/content', (_req, res) => {
      const markdownPath = isDev
        ? path.join(process.cwd(), 'docs/TEMPLATE-DEVELOPER-GUIDE.md')
        : path.join(__dirname, '../../docs/TEMPLATE-DEVELOPER-GUIDE.md');

      if (!fs.existsSync(markdownPath)) {
        logger.error('Documentation markdown not found', { markdownPath });
        res.status(404).send('Documentation content not found.');
        return;
      }

      try {
        const markdown = fs.readFileSync(markdownPath, 'utf-8');

        // Configure marked for better rendering
        marked.setOptions({
          gfm: true,
          breaks: false
        });

        const html = marked.parse(markdown);

        logger.debug('Serving documentation content', {
          markdownPath,
          contentLength: markdown.length
        });

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
      } catch (error) {
        logger.error('Failed to render documentation', { error, markdownPath });
        res.status(500).send('Failed to render documentation.');
      }
    });

    // API endpoint to get web output info
    this.app.get('/api/output/info', (_req, res) => {
      const config = getConfig();
      const hostname = require('os').hostname();
      const networkInterfaces = require('os').networkInterfaces();

      // Get local IP addresses
      const addresses: string[] = [];
      Object.values(networkInterfaces).forEach((iface: any) => {
        if (iface) {
          iface.forEach((addr: any) => {
            if (addr.family === 'IPv4' && !addr.internal) {
              addresses.push(addr.address);
            }
          });
        }
      });

      res.json({
        success: true,
        data: {
          hostname,
          port: this.port,
          wsPort: config.general.wsPort,
          localUrls: addresses.map(addr => `http://${addr}:${this.port}/output`),
          localhostUrl: `http://localhost:${this.port}/output`,
          enabled: config.output.web.enabled,
          cors: config.output.web.cors
        }
      });
    });

    // API endpoint for graphics control (legacy - kept for compatibility)
    this.app.post('/api/graphics/:action', (req, res) => {
      const { action } = req.params;
      const data = req.body;

      logger.info('Graphics API call', { action, data });

      // TODO: Implement graphics control
      res.json({ success: true, action, data });
    });
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Bind to 0.0.0.0 to allow remote access from other devices on the network
        // This is essential for Web Output to work on remote devices
        this.server = this.app.listen(this.port, '0.0.0.0', () => {
          logger.info('Web server started', {
            port: this.port,
            host: '0.0.0.0',
            note: 'Accessible from network devices'
          });
          resolve();
        });

        // Handle server errors (e.g., EADDRINUSE)
        this.server.on('error', (error: NodeJS.ErrnoException) => {
          if (error.code === 'EADDRINUSE') {
            logger.error('Web server port already in use', {
              port: this.port,
              error: error.message
            });
            reject(new Error(`Port ${this.port} is already in use. Please close any other instances of OL-Grafik or change the port in config.json`));
          } else {
            logger.error('Failed to start web server', { error });
            reject(error);
          }
        });
      } catch (error) {
        logger.error('Failed to start web server', { error });
        reject(error);
      }
    });
  }

  /**
   * Stop the server
   */
  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Web server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get server port
   */
  public getPort(): number {
    return this.port;
  }

  /**
   * Get server status
   */
  public isRunning(): boolean {
    return this.server !== null;
  }

  /**
   * Get Express app instance (for testing or advanced usage)
   */
  public getApp(): Express {
    return this.app;
  }
}

/**
 * Get the WebServer singleton instance
 */
export function getWebServer(): WebServer {
  if (!webServerInstance) {
    throw new Error('WebServer not initialized. Create a WebServer instance first.');
  }
  return webServerInstance;
}

