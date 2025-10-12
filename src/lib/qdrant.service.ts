import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@/config/config.service';

type QdrantPoint = {
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
};

type SearchOptions = {
    fileId: string;
    userId?: number;
    limit?: number;
    scoreThreshold?: number;
};

@Injectable()
export class QdrantService {
    private readonly logger = new Logger(QdrantService.name);
    private readonly baseUrl: string;
    private readonly apiKey?: string;
    private readonly resumeCollection: string;
    private ensuredVectorSize?: number;

    constructor(private readonly config: AppConfigService) {
        const cfg = this.config.qdrant;
        this.baseUrl = (cfg?.url || '').replace(/\/+$/, '');
        this.apiKey = cfg?.apiKey || undefined;
        this.resumeCollection = cfg?.resumeCollection || 'resume_chunks';
    }

    get isEnabled(): boolean {
        return !!this.baseUrl;
    }

    async ensureResumeCollection(vectorSize: number): Promise<boolean> {
        if (!this.isEnabled) return false;
        if (!vectorSize || vectorSize <= 0) {
            this.logger.warn('시도된 Qdrant 컬렉션 보장에 잘못된 벡터 차원이 전달되었습니다.');
            return false;
        }
        if (this.ensuredVectorSize === vectorSize) return true;

        try {
            const current = await this.getCollectionConfig();
            const existingSize =
                current?.vectors?.size ??
                current?.config?.params?.vectors?.size ??
                current?.config?.params?.size ??
                null;
            if (existingSize) {
                if (existingSize !== vectorSize) {
                    this.logger.warn(
                        `Qdrant 컬렉션 벡터 차원이 일치하지 않습니다. existing=${existingSize}, expected=${vectorSize}`,
                    );
                    return false;
                }
                this.ensuredVectorSize = vectorSize;
                return true;
            }
        } catch (err: any) {
            if (err?.statusCode !== 404) {
                this.logger.warn(`Qdrant 컬렉션 조회 실패: ${err?.message || err}`);
            }
        }

        try {
            await this.requestJson(`/collections/${this.resumeCollection}`, {
                method: 'PUT',
                body: JSON.stringify({
                    vectors: {
                        size: vectorSize,
                        distance: 'Cosine',
                    },
                }),
            });
            this.ensuredVectorSize = vectorSize;
            return true;
        } catch (err: any) {
            this.logger.error(`Qdrant 컬렉션 생성 실패: ${err?.message || err}`);
            return false;
        }
    }

    async replaceResumeChunks(
        fileId: string,
        points: QdrantPoint[],
        vectorSize: number,
    ): Promise<void> {
        if (!this.isEnabled) return;
        if (vectorSize > 0) {
            const ensured = await this.ensureResumeCollection(vectorSize);
            if (!ensured) return;
        }
        await this.deleteResumeChunks(fileId);

        if (!points.length || vectorSize <= 0) return;

        const batchSize = 64;
        for (let i = 0; i < points.length; i += batchSize) {
            const batch = points.slice(i, i + batchSize).map((p) => ({
                id: p.id,
                vector: Array.from(p.vector ?? [], (v) => Number(v)),
                payload: p.payload,
            }));
            try {
                await this.requestJson(`/collections/${this.resumeCollection}/points`, {
                    method: 'PUT',
                    body: JSON.stringify({ points: batch }),
                });
            } catch (err: any) {
                this.logger.error(`Qdrant 포인트 업서트 실패: ${err?.message || err}`);
                break;
            }
        }
    }

    async deleteResumeChunks(fileId: string): Promise<void> {
        if (!this.isEnabled) return;
        try {
            await this.requestJson(`/collections/${this.resumeCollection}/points/delete`, {
                method: 'POST',
                body: JSON.stringify({
                    filter: {
                        must: [{ key: 'file_id', match: { value: fileId } }],
                    },
                    wait: true,
                }),
            });
        } catch (err: any) {
            this.logger.warn(`Qdrant 포인트 삭제 실패: ${err?.message || err}`);
        }
    }

    async searchResumeChunks(
        vector: number[],
        options: SearchOptions,
    ): Promise<
        Array<{
            text: string;
            score: number;
            payload: Record<string, unknown>;
        }>
    > {
        if (!this.isEnabled) return [];
        if (!vector?.length) return [];
        const must: any[] = [{ key: 'file_id', match: { value: options.fileId } }];
        if (options.userId != null) {
            must.push({ key: 'user_id', match: { value: options.userId } });
        }
        try {
            const res = await this.requestJson(
                `/collections/${this.resumeCollection}/points/search`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        vector: Array.from(vector, (v) => Number(v)),
                        top: options.limit ?? 3,
                        with_payload: true,
                        filter: { must },
                    }),
                },
            );
            const hits = Array.isArray(res?.result) ? res.result : [];
            const threshold = options.scoreThreshold ?? 0;
            return hits
                .filter((hit: any) => typeof hit?.score === 'number' && hit.score >= threshold)
                .map((hit: any) => ({
                    text: String(hit?.payload?.text ?? ''),
                    score: Number(hit.score),
                    payload: (hit?.payload ?? {}) as Record<string, unknown>,
                }));
        } catch (err: any) {
            this.logger.warn(`Qdrant 검색 실패: ${err?.message || err}`);
            return [];
        }
    }

    private async getCollectionConfig(): Promise<any | null> {
        if (!this.isEnabled) return null;
        try {
            const res = await this.requestJson(
                `/collections/${this.resumeCollection}`,
                {},
                {
                    allow404: true,
                },
            );
            return res?.result ?? null;
        } catch (err: any) {
            if (err?.statusCode === 404) return null;
            throw err;
        }
    }

    private async requestJson(
        path: string,
        init: RequestInit = {},
        opts: { allow404?: boolean } = {},
    ): Promise<any> {
        if (!this.isEnabled) {
            throw Object.assign(new Error('Qdrant가 설정되지 않았습니다.'), { statusCode: 503 });
        }

        const existingHeaders = (init.headers as Record<string, string>) || {};
        const headers: Record<string, string> = {
            Accept: 'application/json',
            ...existingHeaders,
        };
        if (init.body && !('Content-Type' in headers)) {
            headers['Content-Type'] = 'application/json';
        }
        if (this.apiKey && !('api-key' in headers)) {
            headers['api-key'] = this.apiKey;
        }

        const response = await fetch(`${this.baseUrl}${path}`, {
            ...init,
            headers,
        }).catch((err: any) => {
            const error = new Error(`Qdrant 요청 실패: ${err?.message || err}`);
            throw Object.assign(error, { statusCode: 503 });
        });

        if (response.status === 404 && opts.allow404) {
            return null;
        }
        if (!response.ok) {
            const text = await response.text();
            const error = new Error(
                `Qdrant 요청 오류 (${response.status}): ${text || response.statusText}`,
            );
            throw Object.assign(error, { statusCode: response.status });
        }

        const text = await response.text();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch {
            return null;
        }
    }
}
