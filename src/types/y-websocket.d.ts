// src/types/y-websocket.d.ts
declare module 'y-websocket/bin/utils' {
    import * as WebSocket from 'ws';
    import { IncomingMessage } from 'http';

    interface WSConnectionOpts {
        docName?: string;
        gc?: boolean;
    }

    export function setupWSConnection(
        conn: WebSocket,
        req: IncomingMessage,
        opts?: WSConnectionOpts,
    ): void;
}
