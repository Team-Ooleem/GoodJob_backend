USE `good_job_test`;

CREATE TABLE IF NOT EXISTS interview_sessions (
  session_id      VARCHAR(64) PRIMARY KEY,
  external_key    VARCHAR(128) UNIQUE NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at        TIMESTAMP NULL
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
  presence_good    INT NOT NULL DEFAULT 0,
  presence_average INT NOT NULL DEFAULT 0,
  presence_needs_improvement INT NOT NULL DEFAULT 0,
  level_ok         INT NOT NULL DEFAULT 0,
  level_info       INT NOT NULL DEFAULT 0,
  level_warning    INT NOT NULL DEFAULT 0,
  level_critical   INT NOT NULL DEFAULT 0,
  left_eye_x_mean  DOUBLE NULL,
  left_eye_y_mean  DOUBLE NULL,
  right_eye_x_mean DOUBLE NULL,
  right_eye_y_mean DOUBLE NULL,
  nose_x_mean      DOUBLE NULL,
  nose_y_mean      DOUBLE NULL,
  started_at_ms    BIGINT NULL,
  ended_at_ms      BIGINT NULL,
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
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, question_id),
  CONSTRAINT fk_amq_q FOREIGN KEY (session_id, question_id) REFERENCES questions(session_id, question_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
