import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '@/config/config.service';

export interface RenderOptions {
    avatarId: string;
    wavBuffer: Buffer; // LINEAR16 WAV
    resolution?: 256 | 512;
    stillMode?: boolean;
    poseScale?: number;
    expressionScale?: number;
    enhance?: boolean;
}

export type RenderResult = {
    mp4Buffer: Buffer;
    durationSec: number;
    resolution: number;
};

@Injectable()
export class AvatarService {
    private readonly logger = new Logger(AvatarService.name);
    private readonly base = process.env.AI_SERVER_BASE_URL || 'http://localhost:8081';
    private readonly token = process.env.AI_SERVER_TOKEN || '';

    constructor(private readonly config: AppConfigService) {}

    async registerImage(file: Express.Multer.File): Promise<{ avatar_id: string; path?: string }> {
        const form = new FormData();
        const blob = new Blob([new Uint8Array(file.buffer)], {
            type: file.mimetype || 'image/jpeg',
        });
        form.append('file', blob, file.originalname || 'avatar.jpg');

        const headers: Record<string, string> = {};
        if (this.token) headers['X-Internal-Token'] = this.token;

        const { data } = await axios.post(`${this.base}/avatar/register-image`, form, {
            headers,
            maxBodyLength: Infinity,
        });
        return data as { avatar_id: string; path?: string };
    }

    async renderSync(opts: RenderOptions): Promise<RenderResult> {
        const form = new FormData();
        form.append('avatar_id', opts.avatarId);

        // wav as Blob
        const audioBlob = new Blob([new Uint8Array(opts.wavBuffer)], { type: 'audio/wav' });
        form.append('audio', audioBlob, 'speech.wav');

        if (opts.resolution) form.append('resolution', String(opts.resolution));
        if (opts.stillMode !== undefined)
            form.append('still_mode', String(Boolean(opts.stillMode)));
        if (opts.poseScale !== undefined) form.append('pose_scale', String(opts.poseScale));
        if (opts.expressionScale !== undefined)
            form.append('expression_scale', String(opts.expressionScale));
        if (opts.enhance !== undefined) form.append('enhance', String(Boolean(opts.enhance)));

        const headers: Record<string, string> = {};
        if (this.token) headers['X-Internal-Token'] = this.token;

        try {
            const res = await axios.post<ArrayBuffer>(`${this.base}/avatar/render-sync`, form, {
                headers,
                responseType: 'arraybuffer',
                timeout: Number(process.env.AVATAR_RENDER_TIMEOUT_MS || 20000),
                maxBodyLength: Infinity,
            });

            const durationHeader = (res.headers['x-duration'] as string) || '0';
            const resolutionHeader = (res.headers['x-resolution'] as string) || '256';

            const durationSec = parseFloat(durationHeader) || 0;
            const resolution = parseInt(resolutionHeader, 10) || 256;
            const mp4Buffer = Buffer.from(res.data);

            return { mp4Buffer, durationSec, resolution };
        } catch (err) {
            this.logger.error(`renderSync failed: ${err}`);
            throw err;
        }
    }
}
