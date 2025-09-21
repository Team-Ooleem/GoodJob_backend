/**
 * 세션 시간 정보 인터페이스
 */
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

/**
 * 시간 체크 결과 인터페이스
 */
export interface TimeCheckResult {
    allowed: boolean;
    message: string;
    timeInfo: SessionTimeInfo;
    shouldWarn: boolean;
    shouldBlock: boolean;
}

/**
 * 세션 시간 설정 인터페이스
 */
export interface SessionTimeSettings {
    maxDurationMs: number; // 최대 세션 시간 (밀리초)
    warningThresholdMs: number; // 경고 임계값 (밀리초)
    criticalThresholdMs: number; // 치명적 경고 임계값 (밀리초)
}

/**
 * 경고 수준 열거형
 */
export enum SessionWarningLevel {
    NONE = 'none',
    WARNING = 'warning',
    CRITICAL = 'critical',
    EXPIRED = 'expired',
}

/**
 * 세션 경고 정보 인터페이스
 */
export interface SessionWarningInfo {
    canvasId: string;
    warningLevel: SessionWarningLevel;
    message: string;
    remainingMinutes: number;
    elapsedMinutes: number;
    timestamp: number;
}

/**
 * 세션 강제 종료 결과 인터페이스
 */
export interface SessionEndResult {
    success: boolean;
    canvasId: string;
    message: string;
    finalDuration?: number;
    finalElapsedMinutes?: number;
}

/**
 * 활성 세션 목록 조회용 인터페이스
 */
export interface ActiveSessionInfo {
    canvasId: string;
    sessionKey: string;
    startTime: number;
    lastActivity: number;
    elapsedMinutes: number;
    remainingMinutes: number;
    participantCount: number;
    warningLevel: SessionWarningLevel;
}
