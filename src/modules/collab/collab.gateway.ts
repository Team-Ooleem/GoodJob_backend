// collab.gateway.ts
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
    cors: { origin: 'http://localhost:3001', credentials: true },
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

    @SubscribeMessage('join')
    handleJoin(client: Socket, room: string) {
        client.join(room);
        const doc = this.getDoc(room);
        const init = Y.encodeStateAsUpdate(doc);
        // 반드시 number[]로 보내면 클라에서 toU8로 복원
        client.emit('init', Array.from(init));
        console.log(`📌 ${client.id} joined ${room}`);
    }

    @SubscribeMessage('sync')
    handleSync(
        client: Socket,
        payload: { room: string; update: Uint8Array | number[] | ArrayBuffer },
    ) {
        const { room, update } = payload;
        const doc = this.getDoc(room);

        // update → Uint8Array 변환
        let u8: Uint8Array;
        if (update instanceof Uint8Array) u8 = update;
        else if (update instanceof ArrayBuffer) u8 = new Uint8Array(update);
        else if (Array.isArray(update)) u8 = Uint8Array.from(update);
        else return;

        Y.applyUpdate(doc, u8);

        // 같은 방의 "다른" 클라에게만 브로드캐스트
        client.to(room).emit('update', Array.from(u8));
    }
}
