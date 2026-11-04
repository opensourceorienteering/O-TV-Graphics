import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry
        entry: 'src/main/index.ts',
        onstart(options) {
          // Only start Electron once when main process is built
          options.startup();
        },
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rolldownOptions: {
              external: [
                'electron',
                // Optional native dependencies for ws/socket.io
                'bufferutil',
                'utf-8-validate',
                // Other common native modules
                'fsevents',
                // Electron-specific modules
                'electron-squirrel-startup',
                // NDI native module (requires NDI SDK)
                '@stagetimerio/grandiose'
              ]
            }
          }
        }
      },
      {
        // Preload scripts
        entry: 'src/preload/index.ts',
        onstart(options) {
          // Reload a running app when the preload script changes. Never start one here: the
          // main entry starts the app, and both builds finish together on `npm run dev`. The
          // plugin's reload() starts Electron when none is running yet, so the two starts raced
          // and launched two apps; the plugin only tracked one, leaving the other orphaned.
          if ((process as NodeJS.Process & { electronApp?: unknown }).electronApp) options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rolldownOptions: {
              external: [
                'electron'
              ]
            }
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@main': path.resolve(__dirname, './src/main'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared')
    }
  },
  build: {
    rolldownOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        graphics: path.resolve(__dirname, 'graphics.html'),
        webOutput: path.resolve(__dirname, 'web-output.html'),
        templatePreview: path.resolve(__dirname, 'template-preview.html')
      }
    }
  },
  server: {
    port: 5175,
    // Electron windows and the development CSP use this port. Never silently move to
    // another port while Electron loads an unrelated app already running on 5175.
    strictPort: true,
    host: '0.0.0.0' // Allow remote access from other machines on the network
  }
});
