import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameState, Player } from '../types.js'; // Note: .js extension for ESM compatibility with ts-node/tsx if needed, or just types if configured

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN }));

// Serve static files from the Vite build directory (at the project root)
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: ALLOWED_ORIGIN,
        methods: ['GET', 'POST'],
    },
});

const PORT = process.env.PORT || 3001;

// Store room states
const rooms = new Map<string, GameState>();

// Helper to broadcast current state to everyone in a room
const broadcastRoomState = (roomId: string) => {
    const state = rooms.get(roomId);
    if (state) {
        io.to(roomId).emit('game-state-update', state);
    }
    broadcastRoomList();
};

const broadcastRoomList = () => {
    const roomList = Array.from(rooms.values()).map(r => ({
        id: r.roomId,
        playerCount: r.players.length,
        phase: r.phase
    }));
    io.emit('room-list-update', roomList);
};

io.on('connection', (socket) => {
    // Send initial room list to new connection
    const initialRooms = Array.from(rooms.values()).map(r => ({
        id: r.roomId,
        playerCount: r.players.length,
        phase: r.phase
    }));
    socket.emit('room-list-update', initialRooms);

    socket.on('join-room', ({ roomId, playerName, playerId }: { roomId: string, playerName: string, playerId: string }) => {
        socket.join(roomId);

        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                roomId,
                phase: 'LOBBY' as any,
                players: [],
                currentWord: null,
                guesserId: null,
                winnerId: null,
                revealOrder: 0,
                selectableWords: null,
                isBoardLocked: false
            });
        }

        const state = rooms.get(roomId);
        if (!state) return;

        // Clean up invalid players
        state.players = state.players.filter(p => p.id !== undefined);

        const existingPlayer = state.players.find(p => p.id === playerId);
        if (existingPlayer) {
            existingPlayer.socketId = socket.id;
            existingPlayer.isConnected = true;
            existingPlayer.name = playerName; // Update name in case it changed
        } else {
            state.players.push({
                id: playerId,
                name: playerName,
                score: 0,
                isHost: state.players.length === 0,
                isGuesser: state.guesserId === playerId,
                hasFinishedDrawing: false,
                drawingOrder: 0,
                drawingData: null,
                socketId: socket.id,
                isConnected: true
            });
        }

        broadcastRoomState(roomId);
    });

    socket.on('drawing-data', ({ roomId, data }: { roomId: string, data: any }) => {
        socket.to(roomId).emit('drawing-data', data);
    });

    socket.on('send-message', ({ roomId, message, playerName }: { roomId: string, message: string, playerName: string }) => {
        io.in(roomId).emit('new-message', {
            playerName,
            message,
            timestamp: new Date().toISOString(),
        });
    });

    socket.on('game-state-update', ({ roomId, state }: { roomId: string, state: GameState }) => {
        rooms.set(roomId, state);
        broadcastRoomState(roomId);
    });

    socket.on('disconnecting', () => {
        for (const roomId of socket.rooms) {
            if (roomId !== socket.id) {
                const state = rooms.get(roomId);
                if (state) {
                    const player = state.players.find(p => p.socketId === socket.id);
                    if (player) {
                        player.isConnected = false;

                        // If host disconnected, migrate host to someone who is connected
                        if (player.isHost) {
                            const nextHost = state.players.find(p => p.isConnected && p.id !== player.id);
                            if (nextHost) {
                                player.isHost = false;
                                nextHost.isHost = true;
                            }
                        }

                        broadcastRoomState(roomId);
                    }

                    // If room is empty (everyone disconnected), consider deleting it
                    const anyConnected = state.players.some(p => p.isConnected);
                    if (!anyConnected) {
                        // Optional: Set a timeout to delete room after some time if no one reconnects
                        rooms.delete(roomId);
                    }
                }
            }
        }
    });

    socket.on('disconnect', () => {
    });

    socket.on('leave-room', ({ roomId, playerId }: { roomId: string, playerId: string }) => {
        socket.leave(roomId);
        const state = rooms.get(roomId);
        if (state) {
            const player = state.players.find(p => p.id === playerId);
            if (player) {
                player.isConnected = false;

                // If host temporarily leaves, migrate host to someone who is connected
                if (player.isHost) {
                    const nextHost = state.players.find(p => p.isConnected && p.id !== player.id);
                    if (nextHost) {
                        player.isHost = false;
                        nextHost.isHost = true;
                    }
                }

                broadcastRoomState(roomId);
            }

            // If room is empty (everyone disconnected), consider deleting it
            const anyConnected = state.players.some(p => p.isConnected);
            if (!anyConnected) {
                rooms.delete(roomId);
            }
        }
    });
});

// SPA Routing: Handle all other requests by serving index.html
app.get('*', (req, eccentricity) => {
    eccentricity.sendFile(path.join(distPath, 'index.html'));
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
