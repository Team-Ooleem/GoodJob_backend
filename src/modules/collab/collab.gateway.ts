import { Injectable } from '@nestjs/common';
import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as Y from 'yjs';
import { DatabaseService } from '../../database/database.service';
import { CanvasService } from '../coaching-resume/canvas.service';

type RoomState = {
    doc: Y.Doc;
    dirty: boolean;
    lastActivity: number;
};

@WebSocketGateway({
    cors: { origin: '*', credentials: true },
})
@Injectable()
export class CollabGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    constructor(
        private readonly db: DatabaseService,
        private readonly canvasService: CanvasService,
    ) {}

    @WebSocketServer() server: Server;
    private rooms = new Map<string, RoomState>();

    private readonly AUTOSAVE_INTERVAL = 30000; // 30초마다 저장
    private readonly IDLE_TIMEOUT = 10 * 60 * 1000; // 10분 idle 시 정리
    private readonly SESSION_DURATION_MS = 60 * 60 * 1000; // 세션 길이: 60분
    private roomTimers = new Map<string, NodeJS.Timeout>();

    // --- 초기화 확인 ---
    afterInit() {
        console.log('🚀 WebSocket server initialized', !!this.server);
        this.startAutoSaveLoop();
    }

    handleConnection(client: Socket) {
        console.log('✅ connected', client.id);
    }

    handleDisconnect(client: Socket) {
        console.log('❌ disconnected', client.id);

        // 클라이언트가 속한 모든 방 확인
        const rooms = Array.from(client.rooms);

        for (const room of rooms) {
            if (room === client.id) continue; // 개인 방 제외

            const roomSet = this.server.sockets.adapter.rooms.get(room);
            const remainingSize = roomSet?.size || 0;

            console.log(`📌 방 ${room}에서 ${client.id} 나감 (남은 인원: ${remainingSize})`);

            // 방에 혼자만 남거나 아무도 없으면 녹화 종료
            if (remainingSize <= 1) {
                console.log('🛑 한 명 이하 남음 - 녹화 종료 신호 전송');
                this.server.to(room).emit('stopRecording', {
                    reason: '참가자가 나가서 녹화가 종료되었습니다.',
                    timestamp: new Date().toISOString(),
                });
            }
        }
    }

    private async getRoom(room: string): Promise<RoomState> {
        let state = this.rooms.get(room);
        if (!state) {
            const doc = new Y.Doc();

            // DB에서 기존 json_data 불러오기
            const row = await this.db.queryOne<{ json_data: string | null }>(
                `SELECT json_data FROM canvas WHERE id = ?`,
                [room],
            );
            if (row?.json_data) {
                try {
                    console.log(`📥 [getRoom] load DB json_data length=${row.json_data.length}`);
                    const update = Buffer.from(row.json_data, 'base64');
                    Y.applyUpdate(doc, update);
                    console.log(
                        `📝 [getRoom] after applyUpdate, map=`,
                        doc.getMap('objects').toJSON(),
                    );
                } catch (err) {
                    console.error(`❌ failed to load canvas state for ${room}`, err);
                }
            }

            state = { doc, dirty: false, lastActivity: Date.now() };

            // Y.Doc 업데이트 → dirty 플래그
            doc.on('update', () => {
                state!.dirty = true;
                state!.lastActivity = Date.now();
            });

            this.rooms.set(room, state);
        }
        return state;
    }

    private startAutoSaveLoop() {
        setInterval(async () => {
            const now = Date.now();
            for (const [roomId, state] of this.rooms.entries()) {
                try {
                    if (state.dirty) {
                        // 🔑 항상 전체 스냅샷 저장
                        const update = Y.encodeStateAsUpdate(
                            state.doc,
                            Y.encodeStateVector(new Y.Doc()),
                        );
                        await this.db.query(`UPDATE canvas SET json_data = ? WHERE id = ?`, [
                            Buffer.from(update).toString('base64'),
                            roomId,
                        ]);
                        state.dirty = false;
                        console.log(`💾 autosaved full snapshot for ${roomId}`);
                    }

                    if (now - state.lastActivity > this.IDLE_TIMEOUT) {
                        this.rooms.delete(roomId);
                        console.log(`🗑️ removed idle room ${roomId}`);
                    }
                } catch (err) {
                    console.error(`❌ autosave failed for ${roomId}`, err);
                }
            }
        }, this.AUTOSAVE_INTERVAL);
    }

    private async getSessionEndTime(room: string): Promise<number | null> {
        try {
            const info = await this.canvasService.getRemainingTimeByCanvas(room);
            if (!info?.scheduled_at) return null;
            const start = new Date(info.scheduled_at);
            return start.getTime() + this.SESSION_DURATION_MS;
        } catch (e) {
            console.error(`❌ failed to fetch session end time for room=${room}`, e);
            return null;
        }
    }

    private async endRoomNow(room: string) {
        try {
            const state = this.rooms.get(room);
            if (state) {
                const update = Y.encodeStateAsUpdate(state.doc, Y.encodeStateVector(new Y.Doc()));
                await this.db.query(`UPDATE canvas SET json_data = ? WHERE id = ?`, [
                    Buffer.from(update).toString('base64'),
                    room,
                ]);
            }
        } catch (e) {
            console.error(`❌ failed to persist final snapshot for room=${room}`, e);
        }

        try {
            this.server.to(room).emit('session-ended');
        } catch (e) {
            console.error(`❌ failed to emit session-ended for room=${room}`, e);
        }

        const t = this.roomTimers.get(room);
        if (t) clearTimeout(t);
        this.roomTimers.delete(room);
        this.rooms.delete(room);

        // 방의 모든 소켓을 방에서 제거
        const roomSet = this.server.sockets.adapter.rooms.get(room);
        if (roomSet) {
            for (const socketId of roomSet) {
                const s = this.server.sockets.sockets.get(socketId);
                s?.leave(room);
            }
        }

        console.log(`⏹️ session closed and room cleared: ${room}`);
    }

    private async scheduleRoomShutdown(room: string) {
        if (this.roomTimers.has(room)) return;

        const endMs = await this.getSessionEndTime(room);
        if (!endMs) return;

        const delay = endMs - Date.now();
        if (delay <= 0) {
            await this.endRoomNow(room);
            return;
        }

        const timer = setTimeout(() => this.endRoomNow(room), delay);
        this.roomTimers.set(room, timer);

        try {
            this.server.to(room).emit('session-remaining-ms', delay);
        } catch {}

        console.log(`⏳ scheduled room shutdown for ${room} in ${Math.round(delay / 1000)}s`);
    }

    // --- Yjs 협업용 join ---
    @SubscribeMessage('joinCanvas')
    async handleJoinCanvas(client: Socket, room: string) {
        if (!room) {
            console.error('❌ joinCanvas called without room');
            return;
        }

        // 세션 종료 시간이 이미 지났으면 안내 후 종료
        const endMs = await this.getSessionEndTime(room);
        if (endMs && endMs - Date.now() <= 0) {
            client.emit('session-ended');
            console.log(`⛔ join denied, session already ended: ${room}`);
            return;
        }

        client.join(room);

        const { doc } = await this.getRoom(room);
        const init = Y.encodeStateAsUpdate(doc);
        console.log(`🚀 [joinCanvas] sending init size=${init.length}`);
        client.emit('init', Array.from(init));

        await this.scheduleRoomShutdown(room);

        console.log(`📌 (Canvas) ${client.id} joined ${room}`);
    }

    // --- Cursor 전용 join ---
    @SubscribeMessage('joinCursor')
    handleJoinCursor(client: Socket, payload: { room: string; clientUUID: string }) {
        const { room, clientUUID } = payload;
        if (!room || !clientUUID) {
            console.error('❌ joinCursor called without room/clientUUID');
            return;
        }

        client.join(room);
        console.log(`🖱️ (Cursor) ${clientUUID} joined ${room}`);
    }

    // --- Yjs 업데이트 동기화 ---
    @SubscribeMessage('sync')
    async handleSync(
        client: Socket,
        payload: { room: string; update: Uint8Array | number[] | ArrayBuffer },
    ) {
        const { room, update } = payload;
        const { doc } = await this.getRoom(room);

        let u8: Uint8Array;
        if (update instanceof Uint8Array) u8 = update;
        else if (update instanceof ArrayBuffer) u8 = new Uint8Array(update);
        else if (Array.isArray(update)) u8 = Uint8Array.from(update);
        else return;

        console.log(`📩 [sync] update 수신: room=${room}, bytes=${u8.length}`);
        Y.applyUpdate(doc, u8);
        console.log(`📝 [sync] after applyUpdate, map=`, doc.getMap('objects').toJSON());

        client.to(room).emit('update', Array.from(u8));

        const state = this.rooms.get(room);
        if (state) state.lastActivity = Date.now();
    }

    // --- WebRTC 전용 join ---
    @SubscribeMessage('joinRtc')
    handleJoinRtc(client: Socket, { room }: { room: string }, callback: (size: number) => void) {
        client.join(room);

        const roomSet = this.server.sockets.adapter.rooms.get(room);
        const size = roomSet?.size || 0;
        console.log(`📌 (RTC) ${client.id} joined ${room} (현재 인원 ${size})`);

        if (size === 2 && roomSet) {
            const [firstClientId] = Array.from(roomSet);
            console.log(`🎯 sending ready to initiator: ${firstClientId}`);
            this.server.to(firstClientId).emit('ready');

            console.log('두명 모두 연결됨! 녹음시작 신호 전송');

            // 🆕 첫 번째 참가자만 녹화 담당으로 지정
            this.server.to(firstClientId).emit('startRecording', {
                message: '두 명 모두 연결되었습니다. 녹음을 시작합니다.',
                isRecorder: true, // 녹화 담당자
            });

            // 🆕 두 번째 참가자는 녹화 안 함
            this.server.to(client.id).emit('startRecording', {
                message: '두 명 모두 연결되었습니다.',
                isRecorder: false, // 녹화 안 함
            });
        }

        if (callback) callback(size);
    }

    // --- WebRTC 시그널링 ---
    @SubscribeMessage('offer')
    handleOffer(client: Socket, payload: { room: string; sdp: RTCSessionDescriptionInit }) {
        console.log(`📡 offer from ${client.id} → room ${payload.room}`);
        client.to(payload.room).emit('offer', { sdp: payload.sdp, from: client.id });
    }

    @SubscribeMessage('answer')
    handleAnswer(client: Socket, payload: { room: string; sdp: RTCSessionDescriptionInit }) {
        console.log(`📡 answer from ${client.id} → room ${payload.room}`);
        client.to(payload.room).emit('answer', { sdp: payload.sdp, from: client.id });
    }

    @SubscribeMessage('ice-candidate')
    handleIceCandidate(client: Socket, payload: { room: string; candidate: RTCIceCandidateInit }) {
        console.log(`📡 ice-candidate from ${client.id} → room ${payload.room}`);
        client.to(payload.room).emit('ice-candidate', {
            candidate: payload.candidate,
            from: client.id,
        });
    }

    // --- Cursor 이벤트 ---
    @SubscribeMessage('cursor')
    handleCursor(
        client: Socket,
        payload: { room: string; clientUUID: string; x: number; y: number },
    ) {
        const { room, clientUUID, x, y } = payload;
        client.to(room).emit('cursor', { clientUUID, x, y });
    }

    @SubscribeMessage('cursor-leave')
    handleCursorLeave(client: Socket, payload: { room: string; clientUUID: string }) {
        const { room, clientUUID } = payload;
        client.to(room).emit('cursor-leave', clientUUID);
        console.log(`👋 cursor hidden: ${clientUUID} in ${room}`);
    }

    // --- FreeDrawing 실시간 스트리밍 ---
    @SubscribeMessage('drawing:start')
    handleDrawingStart(client: Socket, payload: { room: string; id: string; brush?: any }) {
        client.to(payload.room).emit('drawing:start', {
            id: payload.id,
            brush: payload.brush,
        });
    }

    @SubscribeMessage('drawing:progress')
    handleDrawingProgress(
        client: Socket,
        payload: { room: string; id: string; points: number[][]; brush?: any },
    ) {
        client.to(payload.room).emit('drawing:progress', {
            id: payload.id,
            points: payload.points,
            brush: payload.brush,
        });
    }

    @SubscribeMessage('drawing:end')
    handleDrawingEnd(client: Socket, payload: { room: string; id: string }) {
        client.to(payload.room).emit('drawing:end', { id: payload.id });
    }
}
