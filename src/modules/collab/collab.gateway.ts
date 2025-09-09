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

@WebSocketGateway({
    cors: { origin: '*', credentials: true },
})
export class CollabGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    private docs = new Map<string, Y.Doc>();

    // --- 초기화 확인 ---
    afterInit() {
        console.log('🚀 WebSocket server initialized', !!this.server);
    }

    handleConnection(client: Socket) {
        console.log('✅ connected', client.id);
    }

    handleDisconnect(client: Socket) {
        console.log('❌ disconnected', client.id);
    }

    private getDoc(room: string) {
        let doc = this.docs.get(room);
        if (!doc) {
            doc = new Y.Doc();
            this.docs.set(room, doc);
        }
        return doc;
    }

    // --- Yjs 협업용 join ---
    @SubscribeMessage('joinCanvas')
    handleJoinCanvas(client: Socket, room: string) {
        if (!room) {
            console.error('❌ joinCanvas called without room');
            return;
        }

        client.join(room);

        const doc = this.getDoc(room);
        const init = Y.encodeStateAsUpdate(doc);
        client.emit('init', Array.from(init));

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
    handleSync(
        client: Socket,
        payload: { room: string; update: Uint8Array | number[] | ArrayBuffer },
    ) {
        const { room, update } = payload;
        const doc = this.getDoc(room);

        let u8: Uint8Array;
        if (update instanceof Uint8Array) u8 = update;
        else if (update instanceof ArrayBuffer) u8 = new Uint8Array(update);
        else if (Array.isArray(update)) u8 = Uint8Array.from(update);
        else return;

        Y.applyUpdate(doc, u8);
        client.to(room).emit('update', Array.from(u8));
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
}
