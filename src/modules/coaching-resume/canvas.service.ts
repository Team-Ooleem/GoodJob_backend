import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

    /**
     * 캔버스 상세 조회: mentor(owner), mentee(editor/viewer) 정보 포함
     * 접근 권한: 요청자가 해당 캔버스의 참여자(mentor/mentee)여야 함
     */
    async getCanvasDetail(canvasId: string, requesterId: number) {
        if (!canvasId) {
            throw new BadRequestException('canvasId is required');
        }
        if (typeof requesterId !== 'number') {
            throw new ForbiddenException('Unauthorized');
        }

        // 1) 캔버스 기본 정보
        const canvas = await this.db.queryOne<{
            canvas_id: string;
            name: string | null;
            created_by: number;
            created_at: any;
        }>(
            `
            SELECT c.id AS canvas_id, c.name, c.created_by, c.created_at
            FROM canvas c
            WHERE c.id = ?
            `,
            [canvasId],
        );

        if (!canvas) {
            throw new NotFoundException('Canvas not found');
        }

        // 2) 참여자 + 사용자 정보 조회
        const participants = await this.db.query<{
            user_id: number;
            cp_role: 'owner' | 'editor' | 'viewer';
            name: string | null;
            profile_img: string | null;
        }>(
            `
            SELECT cp.user_id, cp.role AS cp_role, u.name, u.profile_img
            FROM canvas_participant cp
            JOIN users u ON u.idx = cp.user_id
            WHERE cp.canvas_id = ?
            `,
            [canvasId],
        );

        // 3) 권한 검사: 요청자가 참여자인지 확인
        const me = participants.find((p) => p.user_id === requesterId);
        if (!me) {
            throw new ForbiddenException('Forbidden');
        }

        // 4) mentor/mentee 매핑 (owner → mentor, others → mentee)
        const mentorRaw = participants.find((p) => p.cp_role === 'owner') || null;
        // 멘티가 여러 명일 수 있으므로 첫 번째 비-owner를 대표로 선택
        const menteeRaw = participants.find((p) => p.cp_role !== 'owner') || null;

        const mentor = mentorRaw
            ? {
                  user_id: mentorRaw.user_id,
                  name: mentorRaw.name,
                  profile_img: mentorRaw.profile_img,
                  role: 'mentor' as const,
              }
            : null;

        const mentee = menteeRaw
            ? {
                  user_id: menteeRaw.user_id,
                  name: menteeRaw.name,
                  profile_img: menteeRaw.profile_img,
                  role: 'mentee' as const,
              }
            : null;

        const myRole = me.cp_role === 'owner' ? 'mentor' : 'mentee';

        return {
            canvas_id: String(canvas.canvas_id),
            name: canvas.name,
            created_by: canvas.created_by,
            created_at: canvas.created_at,
            role: myRole,
            mentor,
            mentee,
        };
    }
}
