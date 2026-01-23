import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameState, Player } from '../types.js'; // Note: .js extension for ESM compatibility with ts-node/tsx if needed, or just types if configured

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*', // In production, replace with your client's URL
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
};

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('join-room', ({ roomId, playerName, playerId }: { roomId: string, playerName: string, playerId: string }) => {
        socket.join(roomId);
        console.log(`Player ${playerName} (${socket.id}) joined room: ${roomId}`);

        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                roomId,
                phase: 'LOBBY' as any, // Cast to any or import GamePhase
                players: [],
                currentWord: null,
                guesserId: null,
                winnerId: null,
                revealOrder: 0,
                selectableWords: null
            });
        }

        const state = rooms.get(roomId);
        if (!state) return;

        // remove player that has undefined id 
        state.players = state.players.filter(p => p.id !== undefined);

        if (!state.players.find(p => p.id === playerId)) {
            state.players.push({
                id: playerId, // We'll use playerId for display but we need socket.id for disconnect
                name: playerName,
                score: 0,
                isHost: state.players.length === 0, // First one is host
                isGuesser: false,
                hasFinishedDrawing: false,
                drawingOrder: 0,
                drawingData: null,
                socketId: socket.id // Add this to Player type
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
                    const originalCount = state.players.length;
                    state.players = state.players.filter(p => p.socketId !== socket.id);

                    if (state.players.length !== originalCount) {
                        // Host migration if host left
                        if (state.players.length > 0 && !state.players.find(p => p.isHost)) {
                            state.players[0].isHost = true;
                        }
                        broadcastRoomState(roomId);
                    }

                    // If room is empty, consider deleting it
                    if (state.players.length === 0) {
                        rooms.delete(roomId);
                    }
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
