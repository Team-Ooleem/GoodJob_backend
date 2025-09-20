USE `new-good-job-test`;

CREATE TABLE IF NOT EXISTS interview_sessions (
  session_id      VARCHAR(64) PRIMARY KEY,
  user_id         INT NOT NULL,
  external_key    VARCHAR(64) NULL COMMENT 'resume_files.id 참조(비고유)',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at        TIMESTAMP NULL,
  INDEX idx_sessions_user_created (user_id, created_at),
  INDEX idx_sessions_external_key (external_key),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(idx) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS questions (
  session_id      VARCHAR(64) NOT NULL,
  question_id     VARCHAR(64) NOT NULL,
  order_no        INT NOT NULL,
  text            TEXT NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, question_id),
  CONSTRAINT fk_q_session FOREIGN KEY (session_id) REFERENCES interview_sessions(session_id) ON DELETE CASCADE,
  INDEX idx_q_order (session_id, order_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 문항 집계 저장(원하면 on-the-fly로 계산만 하고 이 테이블은 생략 가능)
CREATE TABLE IF NOT EXISTS visual_agg_question (
  session_id       VARCHAR(64) NOT NULL,
  question_id      VARCHAR(64) NOT NULL,
  sample_count     INT NOT NULL,
  confidence_mean  DOUBLE NULL,
  confidence_max   DOUBLE NULL,
  smile_mean       DOUBLE NULL,
  smile_max        DOUBLE NULL,
  eye_contact_mean DOUBLE NULL,
  blink_mean       DOUBLE NULL,
  gaze_stability   DOUBLE NULL,
  attention_mean   DOUBLE NULL,
  attention_max    DOUBLE NULL,
  engagement_mean  DOUBLE NULL,
  engagement_max   DOUBLE NULL,
  nervousness_mean DOUBLE NULL,
  nervousness_max  DOUBLE NULL,
  presence_good    INT NOT NULL DEFAULT 0,
  presence_average INT NOT NULL DEFAULT 0,
  presence_needs_improvement INT NOT NULL DEFAULT 0,
  level_ok         INT NOT NULL DEFAULT 0,
  level_info       INT NOT NULL DEFAULT 0,
  level_warning    INT NOT NULL DEFAULT 0,
  level_critical   INT NOT NULL DEFAULT 0,
  started_at_ms    BIGINT NULL,
  ended_at_ms      BIGINT NULL,
  normalized_score DOUBLE NULL COMMENT '캘리브레이션 적용된 정규화 점수',
  calibration_applied TINYINT(1) NOT NULL DEFAULT 0 COMMENT '캘리브레이션 적용 여부',
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, question_id),
  CONSTRAINT fk_vqa_q FOREIGN KEY (session_id, question_id) REFERENCES questions(session_id, question_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 세션 전체 집계 저장(문항 agg 가중 평균)
CREATE TABLE IF NOT EXISTS visual_agg_session (
  session_id       VARCHAR(64) PRIMARY KEY,
  sample_count     INT NOT NULL,
  confidence_mean  DOUBLE NULL,
  confidence_max   DOUBLE NULL,
  smile_mean       DOUBLE NULL,
  smile_max        DOUBLE NULL,
  eye_contact_mean DOUBLE NULL,
  blink_mean       DOUBLE NULL,
  gaze_stability   DOUBLE NULL,
  attention_mean   DOUBLE NULL,
  attention_max    DOUBLE NULL,
  engagement_mean  DOUBLE NULL,
  engagement_max   DOUBLE NULL,
  nervousness_mean DOUBLE NULL,
  nervousness_max  DOUBLE NULL,
  presence_good    INT NOT NULL DEFAULT 0,
  presence_average INT NOT NULL DEFAULT 0,
  presence_needs_improvement INT NOT NULL DEFAULT 0,
  level_ok         INT NOT NULL DEFAULT 0,
  level_info       INT NOT NULL DEFAULT 0,
  level_warning    INT NOT NULL DEFAULT 0,
  level_critical   INT NOT NULL DEFAULT 0,
  started_at_ms    BIGINT NULL,
  ended_at_ms      BIGINT NULL,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vsa_s FOREIGN KEY (session_id) REFERENCES interview_sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 문항별 오디오 분석 결과 저장
CREATE TABLE IF NOT EXISTS audio_metrics_question (
  session_id        VARCHAR(64) NOT NULL,
  question_id       VARCHAR(64) NOT NULL,
  f0_mean           DOUBLE NULL,
  f0_std            DOUBLE NULL,
  f0_cv             DOUBLE NULL,
  f0_std_semitone   DOUBLE NULL,
  rms_std           DOUBLE NULL,
  rms_cv            DOUBLE NULL,
  jitter_like       DOUBLE NULL,
  shimmer_like      DOUBLE NULL,
  silence_ratio     DOUBLE NULL,
  sr                INT NULL,
  normalized_score DOUBLE NULL COMMENT '캘리브레이션 적용된 정규화 점수',
  calibration_applied TINYINT(1) NOT NULL DEFAULT 0 COMMENT '캘리브레이션 적용 여부',
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, question_id),
  CONSTRAINT fk_amq_q FOREIGN KEY (session_id, question_id) REFERENCES questions(session_id, question_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 분석 결과 리포트 저장(선택)
CREATE TABLE IF NOT EXISTS interview_reports (
  session_id     VARCHAR(64) PRIMARY KEY,
  user_id        INT NOT NULL,
  overall_score  INT NOT NULL,
  question_count INT NOT NULL,
  payload        JSON NOT NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ir_session FOREIGN KEY (session_id) REFERENCES interview_sessions(session_id) ON DELETE CASCADE,
  CONSTRAINT fk_ir_user FOREIGN KEY (user_id) REFERENCES users(idx) ON DELETE RESTRICT,
  INDEX idx_ir_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -- Indexes for faster listing/filtering
-- -- MySQL does not support CREATE INDEX IF NOT EXISTS; use drop-if-exists then create
-- DROP INDEX IF EXISTS idx_ir_created_at ON interview_reports;
-- CREATE INDEX idx_ir_created_at ON interview_reports (created_at);


-- 문항별 점수 저장(조회/통계 최적화용)
CREATE TABLE IF NOT EXISTS interview_report_question_scores (
  session_id     VARCHAR(64) NOT NULL,
  question_index INT NOT NULL,
  question_text  TEXT NULL,
  score          INT NOT NULL,
  PRIMARY KEY (session_id, question_index),
  CONSTRAINT fk_irq_session FOREIGN KEY (session_id) REFERENCES interview_sessions(session_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- -- Optional: expose external_key for user-level filtering
-- DROP INDEX IF EXISTS idx_sessions_external_key ON interview_sessions;
-- CREATE INDEX idx_sessions_external_key ON interview_sessions (external_key);

-- Uploaded resume PDFs and their parsing/summary state
CREATE TABLE IF NOT EXISTS resume_files (
  id            VARCHAR(64) PRIMARY KEY,
  user_id       INT NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  s3_key        VARCHAR(512) NOT NULL,
  url           VARCHAR(1024) NOT NULL,
  size          INT NOT NULL DEFAULT 0,
  mimetype      VARCHAR(128) NOT NULL,
  text_content  LONGTEXT NULL,
  summary       TEXT NULL,
  parse_status  ENUM('none','pending','processing','done','error') NOT NULL DEFAULT 'none',
  error_message TEXT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_created (user_id, created_at),
  CONSTRAINT fk_resume_files_user FOREIGN KEY (user_id) REFERENCES users(idx) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- session_calibrations 테이블 생성
CREATE TABLE IF NOT EXISTS session_calibrations (
  session_id           VARCHAR(64) PRIMARY KEY,
  user_id              INT NOT NULL,
  audio_baseline       JSON NULL COMMENT '이번 세션 음성 기준값',
  visual_baseline      JSON NULL COMMENT '이번 세션 영상 기준값',
  calibration_text     VARCHAR(255) NULL COMMENT '캘리브레이션에 사용된 텍스트',
  duration_ms          INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_session_calibration FOREIGN KEY (session_id) 
    REFERENCES interview_sessions(session_id) ON DELETE CASCADE,
  CONSTRAINT fk_session_calibration_user FOREIGN KEY (user_id) 
    REFERENCES users(idx) ON DELETE CASCADE,
  INDEX idx_session_calibration_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 기존 테이블 증설용 ALTER 구문은 초기 스키마에 반영되어 제거됨

-- Resume file chunks with optional embeddings for MMR/RAG
CREATE TABLE IF NOT EXISTS resume_file_chunks (
  chunk_id     BIGINT PRIMARY KEY AUTO_INCREMENT,
  file_id      VARCHAR(64) NOT NULL,
  idx          INT NOT NULL COMMENT '0-based chunk index within file',
  page         INT NULL COMMENT 'page number if available',
  start_offset INT NULL COMMENT 'start char offset in full text',
  end_offset   INT NULL COMMENT 'end char offset in full text',
  text         MEDIUMTEXT NOT NULL,
  vector       MEDIUMBLOB NULL COMMENT 'Float32 vector bytes (embedding)',
  vector_dim   SMALLINT NULL COMMENT 'embedding dimension (e.g., 1536)',
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rfc_file FOREIGN KEY (file_id) REFERENCES resume_files(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rfc_file_idx (file_id, idx),
  INDEX idx_rfc_file_page (file_id, page)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional: fast text search (MySQL 8+ InnoDB supports FULLTEXT)
-- ALTER TABLE resume_file_chunks ADD FULLTEXT INDEX ftx_rfc_text (text);

-- 문항별 내용/맥락 분석 저장 테이블
CREATE TABLE IF NOT EXISTS interview_answer_analyses (
  session_id VARCHAR(64) NOT NULL,
  question_id VARCHAR(64) NOT NULL,
  content_analysis_json JSON NULL,
  context_analysis_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, question_id),
  CONSTRAINT fk_iaa_q FOREIGN KEY (session_id, question_id)
    REFERENCES questions(session_id, question_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
