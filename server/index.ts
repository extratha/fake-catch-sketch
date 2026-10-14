import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import type { GameState } from '../types.js'; // Note: .js extension for ESM compatibility with ts-node/tsx if needed, or just types if configured
import { reduce, createInitialState, type GameAction, type ClientIntent, type ReduceResult } from '../game/reducer.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({ origin: ALLOWED_ORIGIN }));

// Serve static files from the Vite build directory (at the project root)
const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

const MAX_DRAWING_BYTES = 512 * 1024;
const ALLOWED_DRAWING_TYPES = new Set(['image/webp', 'image/png', 'image/jpeg']);

// Latency compensation: estimate each socket's one-way latency from the lowest recent RTT
// and subtract it from the arrival time of a "done" press. Caps limit how much a client
// can gain by faking a slow connection or a large input delay.
const PING_INTERVAL_MS = 2000;
const RTT_SAMPLES = 8;
const MAX_LATENCY_COMPENSATION_MS = 100;
const MAX_INPUT_DELAY_COMPENSATION_MS = 50;

// A dropped connection only counts as leaving after this long, so a brief network blip
// (e.g. a phone switching Wi-Fi → 4G) doesn't skip the player's turn or move the host.
const DISCONNECT_GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS) || 8000;

const httpServer = createServer(app);
const io = new Server(httpServer, {
    // WebSocket only: skips the long-polling phase, which adds latency to early presses
    transports: ['websocket'],
    maxHttpBufferSize: MAX_DRAWING_BYTES + 64 * 1024,
    cors: {
        origin: ALLOWED_ORIGIN,
        methods: ['GET', 'POST'],
    },
});

const PORT = process.env.PORT || 3001;

// Store room states
const rooms = new Map<string, GameState>();

// Drawings are kept out of GameState so state broadcasts stay small; each image is relayed once as binary
type Drawing = { image: Buffer; mime: string };
const drawings = new Map<string, { round: number; byPlayer: Map<string, Drawing> }>();

// Which room/player each socket belongs to. Actions are attributed using this,
// never using ids sent by the client.
const sessions = new Map<string, { roomId: string; playerId: string }>();

const rttSamples = new Map<string, number[]>();

const measureRtt = (socket: Socket) => {
    const sentAt = performance.now();
    socket.timeout(PING_INTERVAL_MS).emit('latency-ping', (err: Error | null) => {
        if (err) return;
        const samples = rttSamples.get(socket.id) ?? [];
        samples.push(performance.now() - sentAt);
        if (samples.length > RTT_SAMPLES) samples.shift();
        rttSamples.set(socket.id, samples);
    });
};

const estimatedOneWayMs = (socketId: string) => {
    const samples = rttSamples.get(socketId);
    if (!samples?.length) return 0;
    return Math.min(Math.min(...samples) / 2, MAX_LATENCY_COMPENSATION_MS);
};

setInterval(() => {
    // Only players in a room need a latency estimate
    for (const socketId of sessions.keys()) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) measureRtt(socket);
    }
}, PING_INTERVAL_MS);

// Helper to broadcast current state to everyone in a room
const broadcastRoomState = (roomId: string) => {
    const state = rooms.get(roomId);
    if (state) {
        io.to(roomId).emit('game-state-update', state);
    }
    broadcastRoomList();
};

const roomSummaries = () => Array.from(rooms.values()).map(r => ({
    id: r.roomId,
    playerCount: r.players.length,
    phase: r.phase
}));

// Only emit to every socket when the list actually changed, not on every game action
let lastRoomList = '';
const broadcastRoomList = () => {
    const list = roomSummaries();
    const serialized = JSON.stringify(list);
    if (serialized === lastRoomList) return;
    lastRoomList = serialized;
    io.emit('room-list-update', list);
};

// Single entry point for every state change: run the shared reducer, then broadcast
// onAccepted runs before the new state is broadcast
const dispatch = (roomId: string, action: GameAction, onAccepted?: (state: GameState) => void): ReduceResult => {
    const state = rooms.get(roomId);
    if (!state) return { ok: false, error: 'Room not found' };

    const result = reduce(state, action);
    if (!result.ok) return result;
    onAccepted?.(result.state);

    if (result.state.players.some(p => p.isConnected)) {
        rooms.set(roomId, result.state);
        const stored = drawings.get(roomId);
        if (stored && stored.round !== result.state.round) drawings.delete(roomId);
        broadcastRoomState(roomId);
    } else {
        // Everyone disconnected
        rooms.delete(roomId);
        drawings.delete(roomId);
        broadcastRoomList();
    }
    return result;
};

const pendingDisconnects = new Map<string, NodeJS.Timeout>();
const graceKey = (roomId: string, playerId: string) => `${roomId}:${playerId}`;

const cancelPendingDisconnect = (roomId: string, playerId: string) => {
    const key = graceKey(roomId, playerId);
    clearTimeout(pendingDisconnects.get(key));
    pendingDisconnects.delete(key);
};

// Explicit leave: takes effect immediately
const leaveCurrentRoom = (socketId: string) => {
    const session = sessions.get(socketId);
    if (!session) return;
    sessions.delete(socketId);
    cancelPendingDisconnect(session.roomId, session.playerId);
    dispatch(session.roomId, { type: 'DISCONNECT', playerId: session.playerId, socketId });
};

// Dropped connection: takes effect after the grace period unless the player rejoins first.
// If they rejoin from a new socket, the reducer ignores this stale socketId anyway.
const scheduleDisconnect = (socketId: string) => {
    const session = sessions.get(socketId);
    if (!session) return;
    sessions.delete(socketId);
    cancelPendingDisconnect(session.roomId, session.playerId);
    const key = graceKey(session.roomId, session.playerId);
    pendingDisconnects.set(key, setTimeout(() => {
        pendingDisconnects.delete(key);
        dispatch(session.roomId, { type: 'DISCONNECT', playerId: session.playerId, socketId });
    }, DISCONNECT_GRACE_MS));
};

io.on('connection', (socket) => {
    // Send initial room list to new connection
    socket.emit('room-list-update', roomSummaries());

    // A few quick samples so the first press of a fresh connection is already compensated
    for (let i = 0; i < 3; i++) setTimeout(() => measureRtt(socket), i * 200);

    socket.on('join-room', ({ roomId, playerName, playerId }: { roomId: string, playerName: string, playerId: string }) => {
        if (typeof roomId !== 'string' || !roomId || typeof playerId !== 'string' || typeof playerName !== 'string') {
            socket.emit('action-error', { message: 'Invalid join request' });
            return;
        }

        const previous = sessions.get(socket.id);
        if (previous && previous.roomId !== roomId) {
            socket.leave(previous.roomId);
            leaveCurrentRoom(socket.id);
        }

        cancelPendingDisconnect(roomId, playerId);

        if (!rooms.has(roomId)) {
            rooms.set(roomId, createInitialState(roomId));
        }

        const result = dispatch(roomId, { type: 'JOIN', playerId, name: playerName, socketId: socket.id });
        if (!result.ok) {
            if (!rooms.get(roomId)?.players.length) rooms.delete(roomId);
            socket.emit('action-error', { message: result.error });
            return;
        }

        socket.join(roomId);
        sessions.set(socket.id, { roomId, playerId });

        // Late joiners / reconnects get the drawings submitted so far this round
        const stored = drawings.get(roomId);
        if (stored) {
            for (const [drawerId, drawing] of stored.byPlayer) {
                socket.emit('drawing', { round: stored.round, playerId: drawerId, ...drawing });
            }
        }
    });

    socket.on('game-action', (intent: ClientIntent) => {
        // Read the clock before any other work so processing time doesn't count against the player
        const arrivedAt = performance.now();

        const session = sessions.get(socket.id);
        if (!session || !intent || typeof intent.type !== 'string') {
            socket.emit('action-error', { message: 'Not in a room' });
            return;
        }

        let action: GameAction;
        if (intent.type === 'FINISH_DRAWING') {
            const inputDelay = Number(intent.inputDelayMs);
            const inputCompensation = Number.isFinite(inputDelay)
                ? Math.min(Math.max(inputDelay, 0), MAX_INPUT_DELAY_COMPENSATION_MS)
                : 0;
            const pressedAt = arrivedAt - estimatedOneWayMs(socket.id) - inputCompensation;
            action = { type: 'FINISH_DRAWING', playerId: session.playerId, pressedAt };
        } else if (intent.type === 'FORCE_FINISH') {
            // Forced players rank by when the host acted — no compensation on their behalf
            action = { type: 'FORCE_FINISH', playerId: session.playerId, targetId: String(intent.targetId), pressedAt: arrivedAt };
        } else {
            action = { ...intent, playerId: session.playerId } as GameAction;
        }

        // Ask a forced player's client to upload whatever is on their canvas. This must reach them
        // before the state update: if they were the last drawer, the update ends DRAWING and unmounts the canvas.
        const requestForcedDrawing = action.type === 'FORCE_FINISH'
            ? (state: GameState) => {
                const target = state.players.find(p => p.id === action.targetId);
                if (target?.socketId) io.to(target.socketId).emit('request-drawing', { round: state.round });
            }
            : undefined;

        const result = dispatch(session.roomId, action, requestForcedDrawing);
        if (!result.ok) {
            socket.emit('action-error', { message: result.error });
        }
    });

    socket.on('submit-drawing', ({ round, image, mime }: { round: number, image: Buffer, mime: string }) => {
        const session = sessions.get(socket.id);
        const state = session && rooms.get(session.roomId);
        if (!session || !state) return;

        const player = state.players.find(p => p.id === session.playerId);
        const valid = Buffer.isBuffer(image)
            && image.length <= MAX_DRAWING_BYTES
            && ALLOWED_DRAWING_TYPES.has(mime)
            && round === state.round
            && player?.hasFinishedDrawing;
        if (!valid) {
            socket.emit('action-error', { message: 'Drawing rejected' });
            return;
        }

        let stored = drawings.get(session.roomId);
        if (!stored || stored.round !== state.round) {
            stored = { round: state.round, byPlayer: new Map() };
            drawings.set(session.roomId, stored);
        }
        if (stored.byPlayer.has(session.playerId)) return;

        stored.byPlayer.set(session.playerId, { image, mime });
        io.to(session.roomId).emit('drawing', { round, playerId: session.playerId, image, mime });
    });

    socket.on('leave-room', () => {
        const session = sessions.get(socket.id);
        if (session) socket.leave(session.roomId);
        leaveCurrentRoom(socket.id);
    });

    socket.on('disconnect', () => {
        rttSamples.delete(socket.id);
        scheduleDisconnect(socket.id);
    });
});

// SPA Routing: Handle all other requests by serving index.html
app.get('*', (req, eccentricity) => {
    eccentricity.sendFile(path.join(distPath, 'index.html'));
});

httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
