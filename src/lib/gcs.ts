/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import * as path from 'path';

/**
 * GCS 서비스 (오디오 청크 업로드용)
 */
@Injectable()
export class GcsService {
    private readonly logger = new Logger(GcsService.name);
    private storage: Storage;
    private bucketName: string;

    constructor() {
        if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            throw new Error('GOOGLE_APPLICATION_CREDENTIALS 환경변수가 없습니다.');
        }
        if (!process.env.GCP_BUCKET_NAME) {
            throw new Error('GCP_BUCKET_NAME 환경변수가 없습니다.');
        }

        // GOOGLE_APPLICATION_CREDENTIALS를 사용하면 자동으로 인증됨
        this.storage = new Storage();
        this.bucketName = process.env.GCP_BUCKET_NAME;
        this.logger.log('Google Cloud Storage Client 초기화 완료');
    }

    /** -------------------------------
     * 오디오 청크 파일 검증
     * -------------------------------- */
    validateAudioChunk(file: { mimetype?: string; size?: number }): {
        isValid: boolean;
        error?: string;
    } {
        if (!file) return { isValid: false, error: '파일이 존재하지 않습니다.' };

        const maxChunkSize = 40 * 1024 * 1024; // 40MB
        if (file.size && file.size > maxChunkSize) {
            return { isValid: false, error: `청크 크기는 ${maxChunkSize / (1024 * 1024)}MB 초과` };
        }

        const allowedMimeTypes = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/mp4', 'audio/ogg'];
        if (file.mimetype && !allowedMimeTypes.includes(file.mimetype)) {
            return { isValid: false, error: '지원되지 않는 오디오 형식입니다.' };
        }

        return { isValid: true };
    }

    /** -------------------------------
     * 고유한 GCS 키 생성
     * -------------------------------- */
    generateGcsKey(
        originalName: string,
        canvasId?: string,
        mentorIdx?: number,
        menteeIdx?: number,
        speakerTag?: number,
    ): string {
        const timestamp = Date.now();
        const randomString = Math.random().toString(36).substring(2, 8);
        const extension = path.extname(originalName) || '.mp4';

        let fileName = '';
        if (canvasId !== undefined && mentorIdx !== undefined && menteeIdx !== undefined) {
            const [first, second] = [mentorIdx, menteeIdx].sort((a, b) => a - b);
            const speakerInfo = speakerTag !== undefined ? `_S${speakerTag}` : '';
            fileName = `C${canvasId}_${first}-${second}${speakerInfo}_${timestamp}_${randomString}${extension}`;
        } else if (canvasId !== undefined) {
            fileName = `C${canvasId}_${timestamp}_${randomString}${extension}`;
        } else {
            fileName = `${timestamp}_${randomString}${extension}`;
        }

        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');

        return `${year}/${month}-${day}/audio/${fileName}`;
    }

    /** -------------------------------
     * GCS에 청크 업로드
     * -------------------------------- */
    async uploadChunk(
        buffer: Buffer,
        gcsKey: string,
        contentType: string,
    ): Promise<{ success: boolean; url?: string; error?: string }> {
        try {
            console.log(`[GCS] 업로드 시작: ${gcsKey}`);
            console.log(`[GCS] 버킷명: ${this.bucketName}`);
            console.log(`[GCS] 파일 크기: ${buffer.length} bytes`);
            console.log(`[GCS] Content-Type: ${contentType}`);
            console.log(
                `[GCS] GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`,
            );

            const bucket = this.storage.bucket(this.bucketName);
            const file = bucket.file(gcsKey);

            // 한 번에 업로드 (40MB 이하 청크 기준)
            await file.save(buffer, { metadata: { contentType }, resumable: false });

            const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${gcsKey}`;
            console.log(`[GCS] 업로드 성공: ${publicUrl}`);
            return { success: true, url: publicUrl };
        } catch (error: unknown) {
            console.error(`[GCS] 업로드 실패: ${gcsKey}`);
            console.error(`[GCS] 오류 상세:`, error);
            if (error instanceof Error) {
                console.error(`[GCS] 오류 메시지: ${error.message}`);
                console.error(`[GCS] 오류 스택: ${error.stack}`);
            }
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}
