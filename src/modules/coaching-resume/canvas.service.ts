import { BadRequestException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateCanvasDto } from './dto/create-canvas.dto';
import { v4 as uuidv4 } from 'uuid';
import { AppConfigService } from '@/config/config.service';
import { generateS3Key, uploadFileToS3 } from '@/lib/s3';

@Injectable()
export class CanvasService {
    constructor(
        private readonly db: DatabaseService,
        private readonly config: AppConfigService,
    ) {}

    async createCanvas(dto: CreateCanvasDto, userId: number) {
        const canvasId: string = uuidv4();

        return this.db.transaction(async (conn) => {
            // 1. 캔버스 생성
            await conn.execute(`INSERT INTO canvas (id, name, created_by) VALUES (?, ?, ?)`, [
                canvasId,
                dto.name ?? null,
                userId,
            ]);

            // 2. 생성자 참여자 등록 (owner)
            await conn.execute(
                `INSERT INTO canvas_participant (canvas_id, user_id, role) VALUES (?, ?, ?)`,
                [canvasId, userId, 'owner'],
            );

            // 3. 다른 사람 참여자 등록 (editor)
            await conn.execute(
                `INSERT INTO canvas_participant (canvas_id, user_id, role) VALUES (?, ?, ?)`,
                [canvasId, dto.participantId, 'editor'],
            );

            return {
                id: canvasId,
                name: dto.name,
                created_by: userId,
                participants: [userId, dto.participantId],
            };
        });
    }

    /**
     * dataURL(Base64) 이미지를 S3에 업로드하고 URL 반환
     */
    async uploadCanvasImage(dataUrl: string, fileName: string): Promise<{ url: string }> {
        if (!dataUrl || !fileName) {
            throw new BadRequestException('dataUrl and fileName are required');
        }

        // dataURL 파싱: data:[mime];base64,xxxx
        const match = dataUrl.match(/^data:(?<mime>[^;]+);base64,(?<data>.+)$/);
        if (!match || !match.groups) {
            throw new BadRequestException('Invalid data URL format. Expected base64 data URL');
        }

        const mimeType = match.groups.mime || 'image/png';
        const base64 = match.groups.data;

        let buffer: Buffer;
        try {
            buffer = Buffer.from(base64, 'base64');
        } catch {
            throw new BadRequestException('Invalid base64 data');
        }
        if (buffer.length === 0) {
            throw new BadRequestException('Empty file data');
        }

        // S3 키 생성 (canvas 폴더 하위에 저장)
        const key = generateS3Key(fileName, 'canvas');

        // S3 업로드 (버킷 정책을 통해 public-read 접근 가정)
        const put = await uploadFileToS3(buffer, key, mimeType, this.config.aws);
        if (!put || !put.success || typeof (put as any).url !== 'string') {
            const msg = (put as any)?.error ?? 'unknown';
            throw new BadRequestException(`S3 upload failed: ${msg}`);
        }

        return { url: (put as any).url as string };
    }
}
