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
            rollupOptions: {
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
                'grandiose'
              ]
            }
          }
        }
      },
      {
        // Preload scripts
        entry: 'src/preload/index.ts',
        onstart(options) {
          // Reload preload scripts when they change
          options.reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
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
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        graphics: path.resolve(__dirname, 'graphics.html'),
        webOutput: path.resolve(__dirname, 'web-output.html'),
        templatePreview: path.resolve(__dirname, 'template-preview.html')
      }
    }
  },
  server: {
    port: 5173,
    host: '0.0.0.0' // Allow remote access from other machines on the network
  }
});

