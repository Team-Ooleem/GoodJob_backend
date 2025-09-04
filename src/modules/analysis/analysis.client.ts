import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class AnalysisClient {
    private base = process.env.ANALYSIS_BASE_URL || 'http://audio-analysis:8081';

    async analyzeAudio(file: Express.Multer.File) {
        // Node<20 환경이면 form-data 패키지 사용
        const form = new FormData();
        form.append('file', new Blob([file.buffer]), file.originalname || 'audio.wav');

        const res = await axios.post(`${this.base}/audio/analyze`, form as any, {
            headers: (form as any).getHeaders ? (form as any).getHeaders() : {},
            maxBodyLength: Infinity,
        });
        return res.data?.features;
    }
}
