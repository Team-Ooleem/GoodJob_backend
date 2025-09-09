import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import * as Y from 'yjs';

@WebSocketGateway({
    cors: {
        origin: process.env.FRONTEND_SUCCESS_URL || 'http://localhost:3001',
        credentials: true,
    },
})
export class CollabGateway implements OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server: Server;
    private docs = new Map<string, Y.Doc>();

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

    // --- Yjs 협업용 ---
    @SubscribeMessage('join')
    handleJoin(client: Socket, room: string) {
        client.join(room);
        const doc = this.getDoc(room);
        const init = Y.encodeStateAsUpdate(doc);
        client.emit('init', Array.from(init));
        console.log(`📌 (Yjs) ${client.id} joined ${room}`);
    }

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
    handleJoinRtc(client: Socket, room: string, callback: (size: number) => void) {
        client.join(room);

        const size = this.server.sockets.adapter.rooms.get(room)?.size || 0;
        console.log(`📌 (RTC) ${client.id} joined ${room} (현재 인원 ${size})`);

        // 두 번째 참가자가 들어왔을 때 → 첫 번째 참가자에게만 ready 전송
        if (size === 2) {
            const roomSet = this.server.sockets.adapter.rooms.get(room);
            if (roomSet) {
                const [firstClientId] = Array.from(roomSet);
                console.log(`🎯 sending ready to initiator: ${firstClientId}`);
                this.server.to(firstClientId).emit('ready');
            }
        }

        if (callback) {
            callback(size);
        }
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
}
