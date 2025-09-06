// src/modules/audio-metrics/analysis.client.ts
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import type { AudioFeatures } from '../audio-metrics/audio-metrics.service';

type AnalyzeResponse = {
    features: Partial<AudioFeatures>;
};

@Injectable()
export class AnalysisClient {
    private readonly base = process.env.AUDIO_API_BASE ?? 'http://localhost:8081';

    async analyzeAudio(file: Express.Multer.File): Promise<Partial<AudioFeatures>> {
        const form = new FormData();

        // ✅ 타입 오류를 피하려면 Buffer → Uint8Array로 감싸 Blob 생성
        const blob = new Blob([new Uint8Array(file.buffer)], {
            type: file.mimetype || 'audio/wav',
        });

        // undici FormData는 (name, Blob|File|string, filename?) 시그니처
        form.append('file', blob, file.originalname || 'audio.wav');

        // ✅ axios에 응답 타입 제네릭을 지정해 any 제거
        const res = await axios.post<AnalyzeResponse>(`${this.base}/audio/analyze`, form, {
            // ❗ 웹 FormData일 땐 boundary 헤더를 직접 건드리지 않습니다
            maxBodyLength: Infinity,
        });

        // res.data는 더 이상 any가 아님 → no-unsafe-member-access/return 해결
        return res.data.features;
    }
}
