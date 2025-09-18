import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { VisualAggregateDto } from './dto/visual-aggregate.dto';

/** 열거형 키 */
type PresenceKey = 'good' | 'average' | 'needs_improvement';
type LevelKey = 'ok' | 'info' | 'warning' | 'critical';

/** 컨트롤러 응답용 타입(프론트 사용) */
export interface QuestionVisualAggregate {
    count: number;
    confidence_mean: number | null;
    confidence_max: number | null;
    smile_mean: number | null;
    smile_max: number | null;
    // 추가 지표 평균/최대치(프론트 RealMediaPipeAnalyzer 연동)
    eye_contact_mean?: number | null;
    blink_mean?: number | null;
    gaze_stability?: number | null;
    attention_mean?: number | null;
    attention_max?: number | null;
    engagement_mean?: number | null;
    engagement_max?: number | null;
    nervousness_mean?: number | null;
    nervousness_max?: number | null;
    presence_dist: Record<PresenceKey, number>;
    level_dist: Record<LevelKey, number>;
    startedAt?: number;
    endedAt?: number;
}

export interface SessionVisualAggregate {
    perQuestion: Record<string, QuestionVisualAggregate>;
    overall: QuestionVisualAggregate;
}

/** DB Row 타입(visual_agg_question) */
interface VisualAggQuestionRow {
    session_id: string;
    question_id: string;
    sample_count: number;

    confidence_mean: number | null;
    confidence_max: number | null;
    smile_mean: number | null;
    smile_max: number | null;

    eye_contact_mean: number | null;
    blink_mean: number | null;
    gaze_stability: number | null;
    attention_mean: number | null;
    attention_max: number | null;
    engagement_mean: number | null;
    engagement_max: number | null;
    nervousness_mean: number | null;
    nervousness_max: number | null;

    presence_good: number;
    presence_average: number;
    presence_needs_improvement: number;

    level_ok: number;
    level_info: number;
    level_warning: number;
    level_critical: number;

    started_at_ms: number | null;
    ended_at_ms: number | null;

    // 캘리브레이션 관련 추가 필드
    normalized_score: number | null;
    calibration_applied: number;
}

/** DB Row 타입(visual_agg_session) */
interface VisualAggSessionRow {
    session_id: string;
    sample_count: number;

    confidence_mean: number | null;
    confidence_max: number | null;
    smile_mean: number | null;
    smile_max: number | null;

    eye_contact_mean?: number | null;
    blink_mean?: number | null;
    gaze_stability?: number | null;
    attention_mean?: number | null;
    attention_max?: number | null;
    engagement_mean?: number | null;
    engagement_max?: number | null;
    nervousness_mean?: number | null;
    nervousness_max?: number | null;

    presence_good: number;
    presence_average: number;
    presence_needs_improvement: number;

    level_ok: number;
    level_info: number;
    level_warning: number;
    level_critical: number;

    started_at_ms: number | null;
    ended_at_ms: number | null;
}

/** 정규화 점수 조회용 타입 */
export interface NormalizedScoreResult {
    score: number;
    calibrationApplied: boolean;
}

@Injectable()
export class MetricsService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * 세션/문항 존재 보장 (idempotent)
     * 질문 순번/텍스트는 필요 시 별도 API로 업데이트 권장
     */
    private async ensureSessionAndQuestion(
        sessionId: string,
        questionId: string,
        userId: number,
    ): Promise<void> {
        await this.db.execute(
            `INSERT IGNORE INTO interview_sessions (session_id, user_id) VALUES (?, ?)`,
            [sessionId, userId],
        );

        await this.db.execute(
            `INSERT IGNORE INTO questions (session_id, question_id, order_no, text)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE question_id = question_id`,
            [sessionId, questionId, 0, ''],
        );
    }

    /**
     * 프론트 집계 업서트 저장
     */
    async upsertQuestionAggregate(
        sessionId: string,
        questionId: string,
        a: VisualAggregateDto,
        userId: number,
    ): Promise<void> {
        await this.ensureSessionAndQuestion(sessionId, questionId, userId);

        await this.db.execute(
            `INSERT INTO visual_agg_question
        (session_id, question_id, sample_count, confidence_mean, confidence_max, smile_mean, smile_max,
         eye_contact_mean, blink_mean, gaze_stability,
         attention_mean, attention_max, engagement_mean, engagement_max, nervousness_mean, nervousness_max,
         presence_good, presence_average, presence_needs_improvement,
         level_ok, level_info, level_warning, level_critical,
         started_at_ms, ended_at_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         sample_count=VALUES(sample_count),
         confidence_mean=VALUES(confidence_mean),
         confidence_max=VALUES(confidence_max),
         smile_mean=VALUES(smile_mean),
         smile_max=VALUES(smile_max),
         eye_contact_mean=VALUES(eye_contact_mean),
         blink_mean=VALUES(blink_mean),
         gaze_stability=VALUES(gaze_stability),
         attention_mean=VALUES(attention_mean),
         attention_max=VALUES(attention_max),
         engagement_mean=VALUES(engagement_mean),
         engagement_max=VALUES(engagement_max),
         nervousness_mean=VALUES(nervousness_mean),
         nervousness_max=VALUES(nervousness_max),
         presence_good=VALUES(presence_good),
         presence_average=VALUES(presence_average),
         presence_needs_improvement=VALUES(presence_needs_improvement),
         level_ok=VALUES(level_ok),
         level_info=VALUES(level_info),
         level_warning=VALUES(level_warning),
         level_critical=VALUES(level_critical),
         started_at_ms=VALUES(started_at_ms),
         ended_at_ms=VALUES(ended_at_ms)`,
            [
                sessionId,
                questionId,
                a.sample_count,
                a.confidence_mean ?? null,
                a.confidence_max ?? null,
                a.smile_mean ?? null,
                a.smile_max ?? null,
                a.eye_contact_mean ?? null,
                a.blink_mean ?? null,
                a.gaze_stability ?? null,
                a.attention_mean ?? null,
                a.attention_max ?? null,
                a.engagement_mean ?? null,
                a.engagement_max ?? null,
                a.nervousness_mean ?? null,
                a.nervousness_max ?? null,
                a.presence_good,
                a.presence_average,
                a.presence_needs_improvement,
                a.level_ok,
                a.level_info,
                a.level_warning,
                a.level_critical,
                a.started_at_ms ?? null,
                a.ended_at_ms ?? null,
            ],
        );
    }

    /**
     * 세션 전체 집계: visual_agg_question을 가중 평균/합산 → visual_agg_session 업서트
     * 그리고 perQuestion + overall 구조로 반환
     */
    async finalizeSession(sessionId: string, userId?: number): Promise<SessionVisualAggregate> {
        if (userId) {
            await this.db.execute(
                `INSERT IGNORE INTO interview_sessions (session_id, user_id) VALUES (?, ?)`,
                [sessionId, userId],
            );
        }
        const rows = await this.db.query<VisualAggQuestionRow>(
            `SELECT * FROM visual_agg_question WHERE session_id=?`,
            [sessionId],
        );

        const { overall, perQuestion } = this.computeSessionFromQuestionRows(rows);

        // DB에 세션 집계 업서트
        await this.db.execute(
            `INSERT INTO visual_agg_session
        (session_id, sample_count, confidence_mean, confidence_max, smile_mean, smile_max,
         eye_contact_mean, blink_mean, gaze_stability,
         attention_mean, attention_max, engagement_mean, engagement_max, nervousness_mean, nervousness_max,
         presence_good, presence_average, presence_needs_improvement,
         level_ok, level_info, level_warning, level_critical,
         started_at_ms, ended_at_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         sample_count=VALUES(sample_count),
         confidence_mean=VALUES(confidence_mean),
         confidence_max=VALUES(confidence_max),
         smile_mean=VALUES(smile_mean),
         smile_max=VALUES(smile_max),
         eye_contact_mean=VALUES(eye_contact_mean),
         blink_mean=VALUES(blink_mean),
         gaze_stability=VALUES(gaze_stability),
         attention_mean=VALUES(attention_mean),
         attention_max=VALUES(attention_max),
         engagement_mean=VALUES(engagement_mean),
         engagement_max=VALUES(engagement_max),
         nervousness_mean=VALUES(nervousness_mean),
         nervousness_max=VALUES(nervousness_max),
         presence_good=VALUES(presence_good),
         presence_average=VALUES(presence_average),
         presence_needs_improvement=VALUES(presence_needs_improvement),
         level_ok=VALUES(level_ok),
         level_info=VALUES(level_info),
         level_warning=VALUES(level_warning),
         level_critical=VALUES(level_critical),
         started_at_ms=VALUES(started_at_ms),
         ended_at_ms=VALUES(ended_at_ms)`,
            [
                sessionId,
                overall.count,
                overall.confidence_mean,
                overall.confidence_max,
                overall.smile_mean,
                overall.smile_max,
                (overall as any).eye_contact_mean ?? null,
                (overall as any).blink_mean ?? null,
                (overall as any).gaze_stability ?? null,
                (overall as any).attention_mean ?? null,
                (overall as any).attention_max ?? null,
                (overall as any).engagement_mean ?? null,
                (overall as any).engagement_max ?? null,
                (overall as any).nervousness_mean ?? null,
                (overall as any).nervousness_max ?? null,
                overall.presence_dist.good,
                overall.presence_dist.average,
                overall.presence_dist.needs_improvement,
                overall.level_dist.ok,
                overall.level_dist.info,
                overall.level_dist.warning,
                overall.level_dist.critical,
                overall.startedAt ?? null,
                overall.endedAt ?? null,
            ],
        );

        return { perQuestion, overall };
    }

    /**
     * 단일 문항 집계 조회
     */
    async getQuestionAggregate(
        sessionId: string,
        questionId: string,
    ): Promise<QuestionVisualAggregate | null> {
        const rows = await this.db.query<VisualAggQuestionRow>(
            `SELECT * FROM visual_agg_question WHERE session_id=? AND question_id=?`,
            [sessionId, questionId],
        );
        if (rows.length === 0) return null;
        return this.mapQuestionRowToAggregate(rows[0]);
    }

    /**
     * 세션 전체 집계 + 문항별 집계 묶어서 조회
     */
    async getSessionAggregate(sessionId: string): Promise<SessionVisualAggregate | null> {
        const sessRows = await this.db.query<VisualAggSessionRow>(
            `SELECT * FROM visual_agg_session WHERE session_id=?`,
            [sessionId],
        );
        const qRows = await this.db.query<VisualAggQuestionRow>(
            `SELECT * FROM visual_agg_question WHERE session_id=?`,
            [sessionId],
        );

        if (sessRows.length === 0 && qRows.length === 0) {
            return null;
        }

        const perQuestion: Record<string, QuestionVisualAggregate> = {};
        for (const r of qRows) {
            perQuestion[r.question_id] = this.mapQuestionRowToAggregate(r);
        }

        // 세션 집계가 없다면 문항 rows로 계산
        let overall: SessionVisualAggregate['overall'];
        if (sessRows.length > 0) {
            const s = sessRows[0];
            overall = {
                count: s.sample_count,
                confidence_mean: s.confidence_mean,
                confidence_max: s.confidence_max,
                smile_mean: s.smile_mean,
                smile_max: s.smile_max,
                eye_contact_mean: (s as any).eye_contact_mean ?? null,
                blink_mean: (s as any).blink_mean ?? null,
                gaze_stability: (s as any).gaze_stability ?? null,
                attention_mean: (s as any).attention_mean ?? null,
                attention_max: (s as any).attention_max ?? null,
                engagement_mean: (s as any).engagement_mean ?? null,
                engagement_max: (s as any).engagement_max ?? null,
                nervousness_mean: (s as any).nervousness_mean ?? null,
                nervousness_max: (s as any).nervousness_max ?? null,
                presence_dist: {
                    good: s.presence_good,
                    average: s.presence_average,
                    needs_improvement: s.presence_needs_improvement,
                },
                level_dist: {
                    ok: s.level_ok,
                    info: s.level_info,
                    warning: s.level_warning,
                    critical: s.level_critical,
                },
                startedAt: s.started_at_ms ?? undefined,
                endedAt: s.ended_at_ms ?? undefined,
            };
        } else {
            // on-the-fly 계산
            overall = this.computeSessionFromQuestionRows(qRows).overall;
        }

        return { perQuestion, overall };
    }

    /**
     * 영상 정규화 점수 조회
     */
    async getNormalizedVisualScore(
        sessionId: string,
        questionId: string,
    ): Promise<NormalizedScoreResult | null> {
        const rows = await this.db.query<{
            normalized_score: number | null;
            calibration_applied: number;
        }>(
            `SELECT normalized_score, calibration_applied 
             FROM visual_agg_question 
             WHERE session_id=? AND question_id=?`,
            [sessionId, questionId],
        );

        if (rows.length === 0 || rows[0].normalized_score === null) {
            return null;
        }

        return {
            score: rows[0].normalized_score,
            calibrationApplied: rows[0].calibration_applied === 1,
        };
    }

    // ======= 내부 유틸 =======

    private mapQuestionRowToAggregate(r: VisualAggQuestionRow): QuestionVisualAggregate {
        const agg: QuestionVisualAggregate = {
            count: r.sample_count,
            confidence_mean: r.confidence_mean,
            confidence_max: r.confidence_max,
            smile_mean: r.smile_mean,
            smile_max: r.smile_max,
            eye_contact_mean: r.eye_contact_mean,
            blink_mean: r.blink_mean,
            gaze_stability: r.gaze_stability,
            attention_mean: r.attention_mean,
            attention_max: r.attention_max,
            engagement_mean: r.engagement_mean,
            engagement_max: r.engagement_max,
            nervousness_mean: r.nervousness_mean,
            nervousness_max: r.nervousness_max,
            presence_dist: {
                good: r.presence_good,
                average: r.presence_average,
                needs_improvement: r.presence_needs_improvement,
            },
            level_dist: {
                ok: r.level_ok,
                info: r.level_info,
                warning: r.level_warning,
                critical: r.level_critical,
            },
            startedAt: r.started_at_ms ?? undefined,
            endedAt: r.ended_at_ms ?? undefined,
        };
        return agg;
    }

    private computeSessionFromQuestionRows(rows: VisualAggQuestionRow[]) {
        // 합산/가중 평균용 누적기
        let totalSamples = 0;
        let confSum = 0;
        let confW = 0;
        let confMaxSum = 0;
        let confMaxW = 0;
        let smileSum = 0;
        let smileW = 0;
        let smileMaxSum = 0;
        let smileMaxW = 0;

        let eyeContactSum = 0;
        let eyeContactW = 0;
        let blinkSum = 0;
        let blinkW = 0;
        let gazeStabSum = 0;
        let gazeStabW = 0;
        let attSum = 0;
        let attW = 0;
        let attMaxSum = 0;
        let attMaxW = 0;
        let engSum = 0;
        let engW = 0;
        let engMaxSum = 0;
        let engMaxW = 0;
        let nervSum = 0;
        let nervW = 0;
        let nervMaxSum = 0;
        let nervMaxW = 0;

        let presGood = 0;
        let presAvg = 0;
        let presNeed = 0;

        let lvlOk = 0;
        let lvlInfo = 0;
        let lvlWarn = 0;
        let lvlCrit = 0;

        let startedAt = Number.POSITIVE_INFINITY;
        let endedAt = 0;

        const perQuestion: Record<string, QuestionVisualAggregate> = {};

        for (const r of rows) {
            const w = r.sample_count;
            totalSamples += w;

            if (r.confidence_mean != null) {
                confSum += r.confidence_mean * w;
                confW += w;
            }
            if (r.confidence_max != null) {
                confMaxSum += r.confidence_max * w;
                confMaxW += w;
            }
            if (r.smile_mean != null) {
                smileSum += r.smile_mean * w;
                smileW += w;
            }
            if (r.smile_max != null) {
                smileMaxSum += r.smile_max * w;
                smileMaxW += w;
            }

            if (r.eye_contact_mean != null) {
                eyeContactSum += r.eye_contact_mean * w;
                eyeContactW += w;
            }
            if (r.blink_mean != null) {
                blinkSum += r.blink_mean * w;
                blinkW += w;
            }
            if (r.gaze_stability != null) {
                gazeStabSum += r.gaze_stability * w;
                gazeStabW += w;
            }
            if (r.attention_mean != null) {
                attSum += r.attention_mean * w;
                attW += w;
            }
            if (r.attention_max != null) {
                attMaxSum += r.attention_max * w;
                attMaxW += w;
            }
            if (r.engagement_mean != null) {
                engSum += r.engagement_mean * w;
                engW += w;
            }
            if (r.engagement_max != null) {
                engMaxSum += r.engagement_max * w;
                engMaxW += w;
            }
            if (r.nervousness_mean != null) {
                nervSum += r.nervousness_mean * w;
                nervW += w;
            }
            if (r.nervousness_max != null) {
                nervMaxSum += r.nervousness_max * w;
                nervMaxW += w;
            }

            presGood += r.presence_good;
            presAvg += r.presence_average;
            presNeed += r.presence_needs_improvement;

            lvlOk += r.level_ok;
            lvlInfo += r.level_info;
            lvlWarn += r.level_warning;
            lvlCrit += r.level_critical;

            if (r.started_at_ms != null) startedAt = Math.min(startedAt, r.started_at_ms);
            if (r.ended_at_ms != null) endedAt = Math.max(endedAt, r.ended_at_ms);

            perQuestion[r.question_id] = this.mapQuestionRowToAggregate(r);
        }

        const overall: SessionVisualAggregate['overall'] = {
            count: totalSamples,
            confidence_mean: confW ? confSum / confW : null,
            confidence_max: confMaxW ? confMaxSum / confMaxW : null,
            smile_mean: smileW ? smileSum / smileW : null,
            smile_max: smileMaxW ? smileMaxSum / smileMaxW : null,
            eye_contact_mean: eyeContactW ? eyeContactSum / eyeContactW : null,
            blink_mean: blinkW ? blinkSum / blinkW : null,
            gaze_stability: gazeStabW ? gazeStabSum / gazeStabW : null,
            attention_mean: attW ? attSum / attW : null,
            attention_max: attMaxW ? attMaxSum / attMaxW : null,
            engagement_mean: engW ? engSum / engW : null,
            engagement_max: engMaxW ? engMaxSum / engMaxW : null,
            nervousness_mean: nervW ? nervSum / nervW : null,
            nervousness_max: nervMaxW ? nervMaxSum / nervMaxW : null,
            presence_dist: {
                good: presGood,
                average: presAvg,
                needs_improvement: presNeed,
            },
            level_dist: {
                ok: lvlOk,
                info: lvlInfo,
                warning: lvlWarn,
                critical: lvlCrit,
            },
            startedAt: Number.isFinite(startedAt) ? startedAt : undefined,
            endedAt: endedAt > 0 ? endedAt : undefined,
        };

        return { overall, perQuestion };
    }
}
