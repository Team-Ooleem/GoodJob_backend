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
    namespace: '/',
    cors: { origin: '*', credentials: true },
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
    handleJoin(client: Socket, payload: { room: string; clientUUID: string }) {
        const { room, clientUUID } = payload;
        client.join(room);

        const doc = this.getDoc(room);
        const init = Y.encodeStateAsUpdate(doc);
        client.emit('init', Array.from(init));

        console.log(`📌 ${clientUUID} joined ${room}`);
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
