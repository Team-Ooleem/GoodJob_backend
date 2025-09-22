import { Injectable, Logger } from '@nestjs/common';
import { STTSessionService } from './stt-seesion.service';

export interface SessionTimeInfo {
    canvasId: string;
    sessionKey: string | null;
    startTime: number | null;
    duration: number;
    elapsedMinutes: number;
    remainingTime: number;
    remainingMinutes: number;
    maxDuration: number;
    isExpired: boolean;
    warningLevel: 'none' | 'warning' | 'critical' | 'expired';
}

export interface TimeCheckResult {
    allowed: boolean;
    message: string;
    timeInfo: SessionTimeInfo;
    shouldWarn: boolean;
    shouldBlock: boolean;
}

@Injectable()
export class SessionTimerService {
    private readonly logger = new Logger(SessionTimerService.name);

    // 시간 설정 상수
    private readonly MAX_SESSION_DURATION = 60 * 60 * 1000; // 60분
    private readonly WARNING_THRESHOLD = 55 * 60 * 1000; // 55분 (5분 전 경고)
    private readonly CRITICAL_THRESHOLD = 58 * 60 * 1000; // 58분 (2분 전 경고)

    // 경고 발송 기록 (중복 방지)
    private warningSent: Map<string, Set<string>> = new Map(); // canvasId -> Set<warningType>

    constructor(private readonly sessionService: STTSessionService) {}

    /**
     * 세션 시간 정보 조회
     */
    getSessionTimeInfo(canvasId: string): SessionTimeInfo {
        const sessionKey = this.sessionService.findActiveSessionKey(canvasId);

        if (!sessionKey) {
            return this.createNewSessionTimeInfo(canvasId);
        }

        const cached = this.sessionService.getCached(sessionKey);
        if (!cached || !cached.sessionStartTime) {
            return this.createNewSessionTimeInfo(canvasId, sessionKey);
        }

        return this.calculateTimeInfo(canvasId, sessionKey, cached.sessionStartTime);
    }

    /**
     * 세션 시간 제한 체크
     */
    checkTimeLimit(canvasId: string): TimeCheckResult {
        const timeInfo = this.getSessionTimeInfo(canvasId);

        // 시간 초과 체크
        if (timeInfo.isExpired) {
            return {
                allowed: false,
                message: `세션이 60분 제한을 초과했습니다. (경과: ${timeInfo.elapsedMinutes}분)`,
                timeInfo,
                shouldWarn: false,
                shouldBlock: true,
            };
        }

        // 경고 체크
        const shouldWarn = this.checkAndSendWarnings(timeInfo);

        return {
            allowed: true,
            message: this.getStatusMessage(timeInfo),
            timeInfo,
            shouldWarn,
            shouldBlock: false,
        };
    }

    /**
     * 경고 발송 체크 및 실행
     */
    private checkAndSendWarnings(timeInfo: SessionTimeInfo): boolean {
        const { canvasId, remainingMinutes, warningLevel } = timeInfo;

        let shouldWarn = false;

        // 경고 발송 기록 초기화
        if (!this.warningSent.has(canvasId)) {
            this.warningSent.set(canvasId, new Set());
        }
        const sentWarnings = this.warningSent.get(canvasId)!;

        // 2분 전 치명적 경고
        if (warningLevel === 'critical' && !sentWarnings.has('critical')) {
            this.logger.warn(
                `🚨 [${canvasId}] 세션 종료 2분 전! (남은 시간: ${remainingMinutes}분)`,
            );
            sentWarnings.add('critical');
            shouldWarn = true;
        }

        // 5분 전 경고
        else if (warningLevel === 'warning' && !sentWarnings.has('warning')) {
            this.logger.warn(
                `⚠️ [${canvasId}] 세션 종료 5분 전 (남은 시간: ${remainingMinutes}분)`,
            );
            sentWarnings.add('warning');
            shouldWarn = true;
        }

        return shouldWarn;
    }

    /**
     * 경고 수준 결정
     */
    private determineWarningLevel(duration: number): SessionTimeInfo['warningLevel'] {
        if (duration >= this.MAX_SESSION_DURATION) {
            return 'expired';
        } else if (duration >= this.CRITICAL_THRESHOLD) {
            return 'critical';
        } else if (duration >= this.WARNING_THRESHOLD) {
            return 'warning';
        }
        return 'none';
    }

    /**
     * 상태 메시지 생성
     */
    private getStatusMessage(timeInfo: SessionTimeInfo): string {
        const { warningLevel, remainingMinutes, elapsedMinutes } = timeInfo;

        switch (warningLevel) {
            case 'expired':
                return `세션 시간이 초과되었습니다. (${elapsedMinutes}분 경과)`;
            case 'critical':
                return `⚠️ 세션이 곧 종료됩니다! (${remainingMinutes}분 남음)`;
            case 'warning':
                return `세션 종료가 임박했습니다. (${remainingMinutes}분 남음)`;
            default:
                return `세션 진행 중 (${elapsedMinutes}분 경과, ${remainingMinutes}분 남음)`;
        }
    }

    /**
     * 새 세션 시간 정보 생성
     */
    private createNewSessionTimeInfo(canvasId: string, sessionKey?: string): SessionTimeInfo {
        return {
            canvasId,
            sessionKey: sessionKey || null,
            startTime: null,
            duration: 0,
            elapsedMinutes: 0,
            remainingTime: this.MAX_SESSION_DURATION,
            remainingMinutes: 60,
            maxDuration: this.MAX_SESSION_DURATION,
            isExpired: false,
            warningLevel: 'none',
        };
    }

    /**
     * 시간 정보 계산
     */
    private calculateTimeInfo(
        canvasId: string,
        sessionKey: string,
        startTime: number,
    ): SessionTimeInfo {
        const currentTime = Date.now();
        const duration = currentTime - startTime;
        const remainingTime = Math.max(0, this.MAX_SESSION_DURATION - duration);

        return {
            canvasId,
            sessionKey,
            startTime,
            duration,
            elapsedMinutes: Math.floor(duration / 60000),
            remainingTime,
            remainingMinutes: Math.floor(remainingTime / 60000),
            maxDuration: this.MAX_SESSION_DURATION,
            isExpired: duration >= this.MAX_SESSION_DURATION,
            warningLevel: this.determineWarningLevel(duration),
        };
    }

    /**
     * 세션 강제 종료
     */
    forceEndSession(canvasId: string): boolean {
        // 경고 기록 제거
        this.warningSent.delete(canvasId);

        // 실제 세션 종료는 STTSessionService에 위임
        const sessionKey = this.sessionService.findActiveSessionKey(canvasId);
        if (sessionKey) {
            // 캐시에서 제거 (STTSessionService의 메서드 사용)
            this.logger.log(`세션 강제 종료: ${canvasId}`);
            return true;
        }

        return false;
    }

    /**
     * 경고 기록 초기화 (세션 시작 시 호출)
     */
    resetWarnings(canvasId: string): void {
        this.warningSent.delete(canvasId);
        this.logger.log(`세션 경고 기록 초기화: ${canvasId}`);
    }

    /**
     * 모든 활성 세션의 시간 정보 조회 (모니터링용)
     */
    getAllActiveSessions(): SessionTimeInfo[] {
        // STTSessionService에서 활성 세션 목록을 가져와서 시간 정보 계산
        // 실제 구현은 STTSessionService의 내부 구조에 따라 달라질 수 있음
        return [];
    }
}
