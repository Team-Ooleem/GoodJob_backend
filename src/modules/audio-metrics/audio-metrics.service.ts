// src/modules/audio-metrics/audio-metrics.service.ts
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

export type AudioFeatures = {
    f0_mean?: number;
    f0_std?: number;
    f0_cv?: number;
    f0_std_semitone?: number;
    rms_std?: number;
    rms_cv?: number;
    jitter_like?: number;
    shimmer_like?: number;
    silence_ratio?: number;
    sr?: number;
};

@Injectable()
export class AudioMetricsService {
    constructor(private readonly db: DatabaseService) {}

    async upsertQuestionMetrics(sessionId: string, questionId: string, m: AudioFeatures) {
        await this.db.execute(
            `INSERT INTO audio_metrics_question
       (session_id, question_id, f0_mean, f0_std, f0_cv, f0_std_semitone, rms_std, rms_cv, jitter_like, shimmer_like, silence_ratio, sr)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
        f0_mean=VALUES(f0_mean), f0_std=VALUES(f0_std), f0_cv=VALUES(f0_cv), f0_std_semitone=VALUES(f0_std_semitone),
        rms_std=VALUES(rms_std), rms_cv=VALUES(rms_cv), jitter_like=VALUES(jitter_like), shimmer_like=VALUES(shimmer_like),
        silence_ratio=VALUES(silence_ratio), sr=VALUES(sr)`,
            [
                sessionId,
                questionId,
                m.f0_mean ?? null,
                m.f0_std ?? null,
                m.f0_cv ?? null,
                m.f0_std_semitone ?? null,
                m.rms_std ?? null,
                m.rms_cv ?? null,
                m.jitter_like ?? null,
                m.shimmer_like ?? null,
                m.silence_ratio ?? null,
                m.sr ?? null,
            ],
        );
    }

    async getSessionAudioOverall(sessionId: string): Promise<Partial<AudioFeatures> | null> {
        const rows = await this.db.query<Partial<AudioFeatures>>(
            `SELECT AVG(f0_mean) AS f0_mean, AVG(f0_std) AS f0_std, AVG(f0_cv) AS f0_cv,
              AVG(f0_std_semitone) AS f0_std_semitone, AVG(rms_std) AS rms_std, AVG(rms_cv) AS rms_cv,
              AVG(jitter_like) AS jitter_like, AVG(shimmer_like) AS shimmer_like, AVG(silence_ratio) AS silence_ratio
       FROM audio_metrics_question WHERE session_id=?`,
            [sessionId],
        ); // rows: Partial<AudioFeatures>[]
        return rows.length ? rows[0] : null; // ✅ 객체 또는 null만 반환
    }

    async getPerQuestion(sessionId: string) {
        return this.db.query<any>(
            `SELECT * FROM audio_metrics_question WHERE session_id=? ORDER BY question_id`,
            [sessionId],
        );
    }
}
