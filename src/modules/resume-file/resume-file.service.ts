import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@/database/database.service';
import { v4 as uuidv4 } from 'uuid';
import { AppConfigService } from '@/config/config.service';
import { generateS3Key, uploadFileToS3, s3 } from '@/lib/s3';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import OpenAI from 'openai';

// Node.js 환경에서 pdfjs-dist 설정
const pdfjsLib = pdfjs.getDocument;

export interface ResumeFileRecord {
    id: string;
    user_id: number;
    original_name: string;
    s3_key: string;
    url: string;
    size: number;
    mimetype: string;
    summary: string | null;
    created_at: string;
}

@Injectable()
export class ResumeFileService {
    private openai: OpenAI;

    constructor(
        private readonly db: DatabaseService,
        private readonly config: AppConfigService,
    ) {
        this.openai = new OpenAI({ apiKey: this.config.openai.apiKey });
    }

    async uploadPdf(file: Express.Multer.File, userId: number) {
        console.log('Original filename:', file.originalname);
        console.log('File size:', file.size);
        console.log('Mimetype:', file.mimetype);
        console.log('Buffer length:', file.buffer.length);
        console.log('latin1 해석:', Buffer.from(file.originalname, 'latin1').toString('utf8'));
        console.log('binary 해석:', Buffer.from(file.originalname, 'binary').toString('utf8'));
        console.log('Bytes:', [...Buffer.from(file.originalname, 'utf8')]);

        const user = await this.db.queryOne(`SELECT idx FROM users WHERE idx=?`, [userId]);
        if (!user) {
            throw new BadRequestException('invalid user (not found)');
        }

        if (file.mimetype !== 'application/pdf') {
            throw new BadRequestException('Only application/pdf is allowed');
        }

        const id = uuidv4();
        const originalName = normalizeOriginalName(file.originalname || 'resume.pdf');
        console.log('Normalized filename:', originalName);
        const key = generateS3Key(originalName, 'documents/resume');

        const put = await uploadFileToS3(file.buffer, key, file.mimetype, this.config.aws);
        if (!put?.success) {
            throw new BadRequestException(`S3 upload failed: ${put?.error ?? 'unknown'}`);
        }

        const sql = `
            INSERT INTO resume_files
            (id, user_id, original_name, s3_key, url, size, mimetype, summary, parse_status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'none', NOW())
        `;
        await this.db.query(sql, [
            id,
            userId,
            originalName,
            key,
            put.url,
            file.size ?? 0,
            file.mimetype,
        ]);

        return {
            id,
            url: put.url,
            originalName,
            size: file.size,
            mimetype: file.mimetype,
        };
    }

    async listMine(userId: number) {
        const rows = (await this.db.query(
            `SELECT id, original_name, url, size, mimetype, summary, parse_status, created_at FROM resume_files WHERE user_id=? ORDER BY created_at DESC`,
            [userId],
        )) as any[];
        return rows.map((r) => ({
            id: r.id as string,
            originalName: r.original_name as string,
            url: r.url as string,
            size: Number(r.size) || 0,
            mimetype: r.mimetype as string,
            hasSummary: !!r.summary,
            parseStatus: r.parse_status as string,
            createdAt: r.created_at as string,
        }));
    }

    async getMine(id: string, userId: number): Promise<ResumeFileRecord> {
        const row = (await this.db.queryOne(`SELECT * FROM resume_files WHERE id=?`, [id])) as
            | any
            | null;
        if (!row) throw new NotFoundException('resume file not found');
        if (row.user_id !== userId) throw new ForbiddenException('forbidden');
        return row as ResumeFileRecord;
    }

    async updateSummary(id: string, userId: number, summary: string): Promise<void> {
        const row = (await this.db.queryOne(`SELECT user_id FROM resume_files WHERE id=?`, [
            id,
        ])) as any | null;
        if (!row) throw new NotFoundException('resume file not found');
        if (row.user_id !== userId) throw new ForbiddenException('forbidden');
        await this.db.query(`UPDATE resume_files SET summary=? WHERE id=?`, [summary, id]);
    }

    async getSummaryById(id: string, userId: number): Promise<string | null> {
        const row = await this.getMine(id, userId);
        return row.summary ?? null;
    }

    /**
     * pdfjs-dist를 사용해 PDF에서 텍스트 추출
     */
    private async extractTextWithPdfjs(buffer: Buffer): Promise<string> {
        try {
            console.log('PDFJS로 PDF 로드 중...');

            // Buffer를 Uint8Array로 변환
            const uint8Array = new Uint8Array(buffer);

            // PDF 문서 로드
            const pdf = await pdfjsLib({
                data: uint8Array,
                // 추가 옵션들
                verbosity: 0, // 로그 레벨 (0: errors only)
                isEvalSupported: false,
                isOffscreenCanvasSupported: false,
            }).promise;

            console.log(`PDF 로드 완료: ${pdf.numPages} 페이지`);

            let fullText = '';

            // 모든 페이지에서 텍스트 추출
            for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
                try {
                    console.log(`페이지 ${pageNum} 처리 중...`);

                    const page = await pdf.getPage(pageNum);
                    const textContent = await page.getTextContent();

                    // 텍스트 아이템들을 문자열로 결합
                    const pageText = textContent.items.map((item: any) => item.str).join(' ');

                    fullText += pageText + '\n';
                    console.log(`페이지 ${pageNum} 텍스트 길이: ${pageText.length}자`);
                } catch (pageError) {
                    console.error(`페이지 ${pageNum} 처리 오류:`, pageError);
                    continue; // 다음 페이지 계속 처리
                }
            }

            console.log(`총 추출된 텍스트 길이: ${fullText.length}자`);
            return fullText.trim();
        } catch (error) {
            console.error('PDFJS 텍스트 추출 오류:', error);
            throw new Error(`PDF 텍스트 추출 실패: ${error.message}`);
        }
    }

    /**
     * Download PDF from S3 and extract text, then summarize via OpenAI.
     */
    async parseAndSummarize(
        id: string,
        userId: number,
    ): Promise<{ textLen: number; summary: string }> {
        const row = await this.getMine(id, userId);

        try {
            await this.db.query(
                `UPDATE resume_files SET parse_status='processing', error_message=NULL WHERE id=?`,
                [id],
            );

            // S3에서 PDF 다운로드
            const key = row.s3_key;
            const bucket = this.config.aws.bucketName;

            console.log(`PDF 다운로드 시작: bucket=${bucket}, key=${key}`);

            const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
            let buffer: Buffer;

            if (obj.Body) {
                const uint8Array = await obj.Body.transformToByteArray();
                buffer = Buffer.from(uint8Array);
                console.log(`다운로드된 PDF 크기: ${buffer.length} bytes`);
            } else {
                throw new Error('S3에서 파일 본문을 가져올 수 없습니다.');
            }

            if (buffer.length === 0) {
                throw new Error('다운로드된 파일이 비어있습니다.');
            }

            // pdfjs-dist로 텍스트 추출
            console.log('PDFJS로 텍스트 추출 시작...');
            const text = await this.extractTextWithPdfjs(buffer);

            if (!text || text.trim().length < 10) {
                throw new BadRequestException(
                    'PDF에서 충분한 텍스트를 추출할 수 없습니다. 이미지 기반 PDF이거나 텍스트가 없는 PDF일 수 있습니다.',
                );
            }

            // 텍스트 정리
            const cleanText = text
                .replace(/\n{3,}/g, '\n\n') // 연속된 개행 줄이기
                .replace(/\s{2,}/g, ' ') // 연속된 공백 줄이기
                .trim();

            console.log(`정리된 텍스트 길이: ${cleanText.length}자`);
            console.log(`첫 300자: ${cleanText.slice(0, 300)}`);

            // 저장용 텍스트 (크기 제한)
            const MAX_TEXT_STORE = 500_000;
            const storeText =
                cleanText.length > MAX_TEXT_STORE ? cleanText.slice(0, MAX_TEXT_STORE) : cleanText;

            // OpenAI로 요약 생성
            const system =
                '너는 채용 담당자다. 아래 이력서 텍스트를 8~12문장으로 간결히 요약하라. 핵심 경력/기술/성과/직무 적합성을 강조하라. 불필요한 수식은 배제하라.';
            const user = `이력서 원문(일부):\n${storeText.slice(0, 12000)}`;

            console.log('OpenAI 요약 생성 시작...');
            const r = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.2,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: user },
                ],
            });

            const summary = (r.choices[0]?.message?.content || '').trim();
            if (!summary) {
                throw new Error('요약 생성 실패');
            }

            console.log('요약 생성 완료, DB 저장 중...');
            await this.db.query(
                `UPDATE resume_files SET text_content=?, summary=?, parse_status='done', error_message=NULL WHERE id=?`,
                [storeText, summary, id],
            );

            return { textLen: cleanText.length, summary };
        } catch (error) {
            console.error(`PDF 처리 오류 (${id}):`, error);

            const errorMsg =
                error instanceof BadRequestException
                    ? error.message
                    : `PDF 처리 중 오류가 발생했습니다: ${error.message}`;

            await this.db.query(
                `UPDATE resume_files SET parse_status='error', error_message=? WHERE id=?`,
                [errorMsg, id],
            );

            throw error;
        }
    }

    async parseAndSummarizeAsync(id: string, userId: number): Promise<void> {
        await this.db.query(
            `UPDATE resume_files SET parse_status='pending', error_message=NULL WHERE id=?`,
            [id],
        );

        setImmediate(async () => {
            try {
                await this.parseAndSummarize(id, userId);
            } catch (e: any) {
                const msg = e?.message || 'parse failed';
                await this.db.query(
                    `UPDATE resume_files SET parse_status='error', error_message=? WHERE id=?`,
                    [msg, id],
                );
            }
        });
    }
}

function normalizeOriginalName(name: string): string {
    if (!name) return 'resume.pdf';

    try {
        // URL 인코딩된 경우 먼저 처리 (프론트에서 encodeURIComponent 사용)
        if (name.includes('%')) {
            try {
                const decoded = decodeURIComponent(name);
                console.log(`파일명 URL 디코딩 성공: "${name}" → "${decoded}"`);
                return decoded;
            } catch (e) {
                console.log('URL 디코딩 실패, 다른 방법 시도:', e.message);
            }
        }

        // URL 인코딩이 아닌 경우, 기존 latin1->utf8 변환 시도
        const corrected = Buffer.from(name, 'latin1').toString('utf8');

        // 한글이나 의미있는 변환인지 확인
        if (
            /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(corrected) ||
            (corrected !== name && corrected.includes('.pdf'))
        ) {
            console.log(`파일명 인코딩 복구 성공: "${name}" → "${corrected}"`);
            return corrected;
        }

        // 복구가 안 되면 원본 사용
        return name;
    } catch (error) {
        console.log(`파일명 처리 오류, 원본 사용: ${name}`);
        return name;
    }
}
