/**
 * WebSocket Server
 * Socket.io server for real-time communication
 */

import { Server as SocketIOServer } from 'socket.io';
import { createServer, Server as HTTPServer } from 'http';
import { getLogger } from '../utils/logger';
import { PortInUseError } from '../utils/portAvailability';

const logger = getLogger();

// Singleton instance
let wsServerInstance: WebSocketServer | null = null;

export interface SPXMessage {
  spxcmd: string;
  [key: string]: any;
}

/**
 * Socket.IO room names for channel separation
 */
export enum SocketRoom {
  PROGRAM_OUTPUT = 'program-output',  // Graphics Window, Web Output, Program Preview
  DATA_PREVIEW = 'data-preview'       // Data Preview renderers
}

/**
 * Client type information
 */
interface ClientInfo {
  socket: any;
  name: string;
  type?: 'graphics' | 'web-output' | 'preview';
  room?: SocketRoom;
}

export class WebSocketServer {
  private httpServer: HTTPServer;
  private io: SocketIOServer;
  private port: number;
  private clients: Map<string, ClientInfo> = new Map();
  private responseCallback: ((data: any) => void) | null = null;
  private previewReadyCallback: ((data: any) => void) | null = null;
  private newClientCallback: ((socketId: string, room: SocketRoom) => void) | null = null;

  constructor(port: number) {
    this.port = port;
    this.httpServer = createServer();
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.setupHandlers();
    // Dedicated feedback namespace: no graphic acknowledgements or program-room membership.
    this.io.of('/control').on('connection', socket => {
      let pending = false, previous = '';
      const publish = async () => {
        if (pending || !socket.connected) return;
        pending = true;
        try {
          const { controlState } = await import('../events/LiveControl');
          const state = await controlState();
          const serialized = JSON.stringify(state);
          if (serialized !== previous && socket.connected) { socket.emit('state', state); previous = serialized; }
        } catch (error) { logger.debug('Control feedback not ready', { error: String(error) }); }
        finally { pending = false; }
      };
      void publish();
      const timer = setInterval(publish, 500);
      socket.on('disconnect', () => clearInterval(timer));
    });

    // Set singleton instance
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- module singleton
    wsServerInstance = this;
  }

  /**
   * Set callback for graphics responses
   */
  setResponseCallback(callback: (data: any) => void): void {
    this.responseCallback = callback;
  }

  /**
   * Set callback for preview renderer ready signal
   */
  setPreviewReadyCallback(callback: (data: any) => void): void {
    this.previewReadyCallback = callback;
  }

  /**
   * Set callback for new client joining a room
   * Used to sync graphics state to newly connected renderers
   */
  setNewClientCallback(callback: (socketId: string, room: SocketRoom) => void): void {
    this.newClientCallback = callback;
  }

  private setupHandlers(): void {
    this.io.on('connection', (socket) => {
      logger.verbose('Socket connection', {
        id: socket.id,
        connections: this.io.engine.clientsCount
      });

      this.clients.set(socket.id, { socket, name: 'unknown' });

      // Handle client identification
      socket.on('SPXMessage2Server', (data: SPXMessage) => {
        this.handleMessage(socket, data);
      });

      // Handle renderer messages
      socket.on('SPXWebRendererMessage', (data: any) => {
        logger.verbose('Renderer message', { data });
        this.io.emit('SPXMessage2Client', data);
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        const client = this.clients.get(socket.id);
        const clientName = client?.name || 'unknown';
        const clientRoom = client?.room;

        logger.verbose('Socket disconnected', {
          id: socket.id,
          name: clientName,
          room: clientRoom,
          connections: this.io.engine.clientsCount
        });

        // Notify other clients in the same room
        if (clientRoom) {
          this.io.to(clientRoom).emit('SPXMessage2Client', {
            spxcmd: 'clientLostNotification',
            source: 'windowClose',
            clientName
          });
        }

        this.clients.delete(socket.id);
      });
    });
  }

  private handleMessage(socket: any, data: SPXMessage): void {
    logger.verbose('Message from client', { cmd: data.spxcmd, data });

    switch (data.spxcmd) {
      case 'identifyClient': {
        const client = this.clients.get(socket.id);
        if (client) {
          client.name = data.name;

          // Determine client type and room based on name
          let clientType: 'graphics' | 'web-output' | 'preview' | undefined;
          let room: SocketRoom | undefined;

          if (data.name === 'GRAPHICS_RENDERER') {
            clientType = 'graphics';
            room = SocketRoom.PROGRAM_OUTPUT;
          } else if (data.name.startsWith('WEB_RENDERER_')) {
            clientType = 'web-output';
            room = SocketRoom.PROGRAM_OUTPUT;
          } else if (data.name.startsWith('PREVIEW_RENDERER_')) {
            clientType = 'preview';
            room = SocketRoom.DATA_PREVIEW;
          }

          // Update client info
          client.type = clientType;
          client.room = room;
          this.clients.set(socket.id, client);

          // Join the appropriate room
          if (room) {
            socket.join(room);
            logger.info('Client joined room', {
              id: socket.id,
              name: data.name,
              type: clientType,
              room
            });

            // Notify PlaybackEngine about new client joining program-output room
            // This allows syncing graphics state to the new renderer
            // Use setImmediate to avoid blocking the identification response
            if (room === SocketRoom.PROGRAM_OUTPUT && this.newClientCallback) {
              setImmediate(() => {
                try {
                  this.newClientCallback!(socket.id, room);
                } catch (error) {
                  logger.error('Error in newClientCallback', {
                    socketId: socket.id,
                    room,
                    error: error instanceof Error ? error.message : String(error)
                  });
                }
              });
            }
          } else {
            logger.warn('Client type not recognized, no room assigned', {
              id: socket.id,
              name: data.name
            });
          }
        }
        break;
      }

      case 'saveToLog': {
        const level = (data.level || 'info') as 'error' | 'warn' | 'info' | 'verbose' | 'debug';
        const ref = data.fileref || 'unknown';
        logger[level](`TemplateLog [${ref}] --> ${data.message}`);
        break;
      }

      case 'graphics:response':
        // Graphics renderer response to a command
        logger.verbose('Graphics response received', {
          command: data.command,
          id: data.id,
          success: data.result?.success
        });

        // Call response callback if set (for PlaybackEngine)
        if (this.responseCallback) {
          this.responseCallback(data);
        }
        break;

      case 'previewRendererReady':
        // Preview renderer ready signal
        logger.verbose('Preview renderer ready signal received', {
          clientId: data.clientId
        });

        // Call preview ready callback if set (for PreviewEngine)
        if (this.previewReadyCallback) {
          this.previewReadyCallback(data);
        }
        break;

      case 'preview:response':
        // Preview renderer response to a command (load, play, stop, etc.)
        // These are informational only - we don't need to track preview state
        logger.verbose('Preview response received', {
          command: data.command,
          id: data.id,
          success: data.result?.success
        });
        break;

      default:
        logger.warn('Unknown SPXMessage2Server command', { cmd: data.spxcmd });
    }
  }

  /**
   * Broadcast message to all clients
   */
  public broadcast(message: SPXMessage): void {
    this.io.emit('SPXMessage2Client', message);
  }

  /**
   * Broadcast message to a specific room
   */
  public broadcastToRoom(room: SocketRoom, message: SPXMessage): void {
    this.io.to(room).emit('SPXMessage2Client', message);
    logger.verbose('Broadcast to room', { room, spxcmd: message.spxcmd });
  }

  /**
   * Send message to specific client
   */
  public sendToClient(socketId: string, message: SPXMessage): void {
    const client = this.clients.get(socketId);
    if (client) {
      client.socket.emit('SPXMessage2Client', message);
    }
  }

  /**
   * Get connected clients count
   */
  public getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get count of clients in a specific room
   */
  public getRoomClientCount(room: SocketRoom): number {
    const sockets = this.io.sockets.adapter.rooms.get(room);
    return sockets ? sockets.size : 0;
  }

  /**
   * Get clients in a specific room
   */
  public getRoomClients(room: SocketRoom): ClientInfo[] {
    const roomClients: ClientInfo[] = [];
    for (const [, client] of this.clients.entries()) {
      if (client.room === room) {
        roomClients.push(client);
      }
    }
    return roomClients;
  }

  /**
   * Get Socket.IO server instance
   */
  public getServer(): SocketIOServer {
    return this.io;
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Handle server errors (e.g., EADDRINUSE)
      const handleError = (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          logger.error('WebSocket server port already in use', {
            port: this.port,
            error: error.message
          });
          reject(new PortInUseError(this.port));
        } else {
          logger.error('Failed to start WebSocket server', { error });
          reject(error);
        }
      };
      this.httpServer.once('error', handleError);

      try {
        // Bind to 0.0.0.0 to allow remote access from other devices on the network
        // This is essential for Web Output to work on remote devices
        this.httpServer.listen(this.port, '0.0.0.0', () => {
          this.httpServer.removeListener('error', handleError);
          logger.info('WebSocket server started', {
            port: this.port,
            host: '0.0.0.0',
            note: 'Accessible from network devices'
          });
          resolve();
        });
      } catch (error) {
        logger.error('Failed to start WebSocket server', { error });
        reject(error);
      }
    });
  }

  /**
   * Stop the server
   */
  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.io.close(() => {
        this.httpServer.close(() => {
          logger.info('WebSocket server stopped');
          wsServerInstance = null;
          resolve();
        });
      });
    });
  }
}

/**
 * Get the WebSocketServer singleton instance
 */
export function getWebSocketServer(): WebSocketServer | null {
  return wsServerInstance;
}
