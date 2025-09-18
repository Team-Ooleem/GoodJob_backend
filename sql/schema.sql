-- MySQL dump 10.13  Distrib 8.0.43, for Win64 (x86_64)
--
-- Host: localhost    Database: good_job
-- ------------------------------------------------------
-- Server version	8.0.43

-- 데이터베이스 생성 (이미 존재하는 경우 무시)
CREATE DATABASE IF NOT EXISTS `new-good-job-test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `new-good-job-test`;

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `idx` int NOT NULL AUTO_INCREMENT COMMENT '고유값',
  `name` varchar(45) NOT NULL COMMENT '사용자 이름',
  `phone` varchar(15) DEFAULT NULL COMMENT '사용자 핸드폰번호',
  `email` varchar(255) NOT NULL COMMENT '사용자 이메일',
  `bio` text COMMENT '소개\n',
  `profile_img` varchar(500) DEFAULT NULL COMMENT '프로필 이미지 URL',
  `created_at` datetime NOT NULL COMMENT '생성일',
  `updated_at` datetime DEFAULT NULL COMMENT '수정일',
  PRIMARY KEY (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='공통 유저 정보 테이블 입니다.';

DROP TABLE IF EXISTS `social_account`;
CREATE TABLE `social_account` (
  `user_idx` int NOT NULL COMMENT '유저정보',
  `provider_id` varchar(255) NOT NULL COMMENT '서비스토큰',
  `created_at` datetime DEFAULT NULL COMMENT '소셜 계정 연동일시',
  KEY `social_user_idx_idx` (`user_idx`),
  CONSTRAINT `social_user_idx` FOREIGN KEY (`user_idx`) REFERENCES `users` (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='소셜로그인';

DROP TABLE IF EXISTS `job_category`;
CREATE TABLE `job_category` (
  `id` int NOT NULL COMMENT '직무 카테고리 코드',
  `name` varchar(50) NOT NULL COMMENT '직무 카테고리명 (IT/개발, 마케팅, 영업 등)',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='직무 카테고리 테이블';

DROP TABLE IF EXISTS `posts`;
CREATE TABLE `posts` (
  `post_idx` int NOT NULL AUTO_INCREMENT COMMENT '게시글 고유 ID',
  `user_id` int NOT NULL COMMENT '작성자 ID',
  `content` text COMMENT '게시글 내용',
  `media_url` varchar(500) DEFAULT NULL COMMENT '첨부 미디어 파일 URL',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '작성일시',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
  PRIMARY KEY (`post_idx`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `posts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='게시글 테이블';


DROP TABLE IF EXISTS `post_comments`;
CREATE TABLE `post_comments` (
  `comment_id` int NOT NULL AUTO_INCREMENT COMMENT '댓글 고유 ID',
  `post_idx` int NOT NULL COMMENT '게시글 ID',
  `user_id` int NOT NULL COMMENT '댓글 작성자 ID',
  `content` text NOT NULL COMMENT '댓글 내용',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '댓글 작성일시',
  PRIMARY KEY (`comment_id`),
  KEY `post_idx` (`post_idx`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `post_comments_ibfk_1` FOREIGN KEY (`post_idx`) REFERENCES `posts` (`post_idx`) ON DELETE CASCADE,
  CONSTRAINT `post_comments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='게시글 댓글 테이블';

DROP TABLE IF EXISTS `post_likes`;
CREATE TABLE `post_likes` (
  `like_id` int NOT NULL AUTO_INCREMENT COMMENT '좋아요 고유 ID',
  `post_idx` int NOT NULL COMMENT '게시글 ID',
  `user_id` int NOT NULL COMMENT '좋아요 누른 사용자 ID',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '좋아요 누른 일시',
  PRIMARY KEY (`like_id`),
  UNIQUE KEY `unique_like` (`post_idx`,`user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `post_likes_ibfk_1` FOREIGN KEY (`post_idx`) REFERENCES `posts` (`post_idx`) ON DELETE CASCADE,
  CONSTRAINT `post_likes_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='게시글 좋아요 테이블';

DROP TABLE IF EXISTS `follow`;
CREATE TABLE `follow` (
  `idx` int NOT NULL AUTO_INCREMENT COMMENT '고유 인덱스',
  `follower_idx` int NOT NULL COMMENT '팔로워',
  `following_idx` int NOT NULL COMMENT '팔로잉',
  `created_at` datetime DEFAULT NULL COMMENT '팔로우 시작일시',
  PRIMARY KEY (`idx`),
  KEY `follow_user_idx_idx` (`follower_idx`),
  KEY `following_user_idx_idx` (`following_idx`),
  CONSTRAINT `follow_user_idx` FOREIGN KEY (`follower_idx`) REFERENCES `users` (`idx`),
  CONSTRAINT `following_user_idx` FOREIGN KEY (`following_idx`) REFERENCES `users` (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='팔로우';

DROP TABLE IF EXISTS `job_role`;
CREATE TABLE `job_role` (
  `id` int NOT NULL COMMENT '직무 코드 (사람인 직무코드 형식)',
  `category_id` int NOT NULL COMMENT '소속 직무 카테고리 코드',
  `name` varchar(50) NOT NULL COMMENT '직무명 (프론트엔드 개발자, 백엔드 개발자 등)',
  PRIMARY KEY (`id`),
  KEY `category_id` (`category_id`),
  CONSTRAINT `job_role_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `job_category` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='직무 상세 테이블 (사람인 2depth 구조)';

DROP TABLE IF EXISTS `conversations`;
CREATE TABLE `conversations` (
  `conversation_id` int NOT NULL AUTO_INCREMENT COMMENT '채팅방 고유 ID',
  `user1_id` int NOT NULL COMMENT '사용자 1 ID (작은 ID가 우선)',
  `user2_id` int NOT NULL COMMENT '사용자 2 ID (큰 ID)',
  `last_message_id` int DEFAULT NULL COMMENT '마지막 메시지 ID',
  `last_message_time` datetime DEFAULT NULL COMMENT '마지막 메시지 시간',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '채팅방 생성일시',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '채팅방 수정일시',
  PRIMARY KEY (`conversation_id`),
  UNIQUE KEY `unique_conversation` (`user1_id`, `user2_id`),
  KEY `user1_id_idx` (`user1_id`),
  KEY `user2_id_idx` (`user2_id`),
  KEY `last_message_time_idx` (`last_message_time`),
  CONSTRAINT `conversations_user1_fk` FOREIGN KEY (`user1_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE,
  CONSTRAINT `conversations_user2_fk` FOREIGN KEY (`user2_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='1:1 채팅방 테이블';

DROP TABLE IF EXISTS `messages`;
CREATE TABLE `messages` (
  `message_id` int NOT NULL AUTO_INCREMENT COMMENT '메시지 고유 ID',
  `conversation_id` int DEFAULT NULL COMMENT '채팅방 ID',
  `sender_id` int NOT NULL COMMENT '발신자 ID',
  `receiver_id` int NOT NULL COMMENT '수신자 ID',
  `content` text NOT NULL COMMENT '메시지 내용',
  `is_read` tinyint(1) NOT NULL DEFAULT '0' COMMENT '읽음 상태 (0: 안읽음, 1: 읽음)',
  `read_at` datetime DEFAULT NULL COMMENT '읽은 시간',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '발송일시',
  PRIMARY KEY (`message_id`),
  KEY `conversation_id_idx` (`conversation_id`),
  KEY `sender_id` (`sender_id`),
  KEY `receiver_id` (`receiver_id`),
  KEY `is_read` (`is_read`),
  CONSTRAINT `messages_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`conversation_id`) ON DELETE CASCADE,
  CONSTRAINT `messages_ibfk_1` FOREIGN KEY (`sender_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE,
  CONSTRAINT `messages_ibfk_2` FOREIGN KEY (`receiver_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='메시지 테이블';

DROP TABLE IF EXISTS `conversation_read_status`;
CREATE TABLE `conversation_read_status` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '고유 ID',
  `conversation_id` int NOT NULL COMMENT '채팅방 ID',
  `user_id` int NOT NULL COMMENT '사용자 ID',
  `last_read_message_id` int DEFAULT NULL COMMENT '마지막으로 읽은 메시지 ID',
  `last_read_time` datetime DEFAULT NULL COMMENT '마지막 읽은 시간',
  `unread_count` int NOT NULL DEFAULT '0' COMMENT '읽지 않은 메시지 수',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_conversation` (`conversation_id`, `user_id`),
  KEY `conversation_id_idx` (`conversation_id`),
  KEY `user_id_idx` (`user_id`),
  CONSTRAINT `conversation_read_status_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`conversation_id`) ON DELETE CASCADE,
  CONSTRAINT `conversation_read_status_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='채팅방 읽음 상태 테이블';

-- 외래키 제약조건 없이 테이블 생성
DROP TABLE IF EXISTS `stt_speaker_segments`;
DROP TABLE IF EXISTS `stt_transcriptions`;

CREATE TABLE `stt_transcriptions` (
  `stt_session_idx` INT NOT NULL AUTO_INCREMENT COMMENT '세션 고유 ID',
  `canvas_id` CHAR(36) NOT NULL COMMENT '캔버스 ID (UUID)',
  `mentor_idx` INT NOT NULL COMMENT '멘토 user_id',
  `mentee_idx` INT NOT NULL COMMENT '멘티 user_id',
  `audio_url` TEXT NOT NULL COMMENT '오디오 파일 URL',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시간',
  PRIMARY KEY (`stt_session_idx`),
  KEY `mentor_idx_idx` (`mentor_idx`),
  KEY `mentee_idx_idx` (`mentee_idx`),
  KEY `canvas_idx_idx` (`canvas_id`)
  -- 외래키 제약조건 제거
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='STT 세션 테이블';

CREATE TABLE `stt_speaker_segments` (
  `segment_idx` INT NOT NULL AUTO_INCREMENT COMMENT '세그먼트 고유 ID',
  `stt_session_idx` INT NOT NULL COMMENT '세션 ID (FK)',
  `speaker_idx` INT NOT NULL COMMENT '화자 번호 (0=멘토, 1=멘티)',
  `text_content` TEXT NOT NULL COMMENT '인식된 텍스트',
  `start_time` DECIMAL(10,1) NOT NULL COMMENT '시작 시각 (초)',
  `end_time` DECIMAL(10,1) NOT NULL COMMENT '종료 시각 (초)',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '생성 시간',
  PRIMARY KEY (`segment_idx`),
  KEY `stt_session_idx_idx` (`stt_session_idx`)
  -- 외래키 제약조건 제거
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='STT 화자 세그먼트 테이블';

-- 멘토 프로필 정보 테이블
DROP TABLE IF EXISTS `mentor_profiles`;
CREATE TABLE `mentor_profiles` (
  `mentor_idx` INT NOT NULL AUTO_INCREMENT COMMENT '멘토 고유 ID',
  `user_idx` INT NOT NULL COMMENT '유저 ID (users 테이블 FK)',
  `contact_email` VARCHAR(255) NOT NULL COMMENT '연락받을 이메일',
  `business_name` VARCHAR(255) NOT NULL COMMENT '지식공유자 실명 또는 사업체명',
  `contact_phone` VARCHAR(20) NOT NULL COMMENT '연락처',
  `preferred_field_id` INT NOT NULL COMMENT '희망분야 (job_category 테이블 FK)',
  `introduction` TEXT NOT NULL COMMENT '나를 소개하는 글',
  `portfolio_link` VARCHAR(500) NULL COMMENT '나를 표현할 수 있는 링크',
  `is_approved` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '멘토 승인 상태 (0: 대기, 1: 승인)',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
  PRIMARY KEY (`mentor_idx`),
  UNIQUE KEY `unique_user_mentor` (`user_idx`),
  KEY `mentor_user_idx` (`user_idx`),
  KEY `preferred_field_idx` (`preferred_field_id`),
  CONSTRAINT `mentor_profiles_user_fk` FOREIGN KEY (`user_idx`) REFERENCES `users` (`idx`) ON DELETE CASCADE,
  CONSTRAINT `mentor_profiles_category_fk` FOREIGN KEY (`preferred_field_id`) REFERENCES `job_category` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='멘토 프로필 정보 테이블';

-- 멘토링 상품 테이블
DROP TABLE IF EXISTS `mentoring_products`;
CREATE TABLE `mentoring_products` (
  `product_idx` INT NOT NULL AUTO_INCREMENT COMMENT '멘토링 상품 고유 ID',
  `mentor_idx` INT NOT NULL COMMENT '멘토 ID (mentor_profiles 테이블 FK)',
  `title` VARCHAR(255) NOT NULL COMMENT '멘토링 제목',
  `job_category_id` INT NOT NULL COMMENT '멘토링 직무 카테고리 (job_category 테이블 FK)',
  `description` TEXT NOT NULL COMMENT '해당 멘토링 소개',
  `price` DECIMAL(10,0) NOT NULL COMMENT '멘토링 가격 (원)',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '활성 상태 (0: 비활성, 1: 활성)',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
  PRIMARY KEY (`product_idx`),
  KEY `mentor_idx_idx` (`mentor_idx`),
  KEY `job_category_idx` (`job_category_id`),
  KEY `is_active_idx` (`is_active`),
  CONSTRAINT `mentoring_products_mentor_fk` FOREIGN KEY (`mentor_idx`) REFERENCES `mentor_profiles` (`mentor_idx`) ON DELETE CASCADE,
  CONSTRAINT `mentoring_products_category_fk` FOREIGN KEY (`job_category_id`) REFERENCES `job_category` (`id`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='멘토링 상품 테이블';

-- 멘토링 정기 스케줄 테이블 (멘토가 설정한 시간표 - 요일별 시간 단위)
DROP TABLE IF EXISTS `mentoring_regular_slots`;
CREATE TABLE `mentoring_regular_slots` (
  `regular_slots_idx` INT NOT NULL AUTO_INCREMENT COMMENT '정기 스케줄 고유 ID',
  `product_idx` INT NOT NULL COMMENT '멘토링 상품 ID (mentoring_products 테이블 FK)',
  `day_of_week` TINYINT(1) NOT NULL COMMENT '요일 (1=월요일, 2=화요일, ..., 7=일요일)',
  `hour_slot` TINYINT(2) NOT NULL COMMENT '시간대 (0~23시)',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
  PRIMARY KEY (`regular_slots_idx`),
  UNIQUE KEY `unique_schedule_slot` (`product_idx`, `day_of_week`, `hour_slot`),
  KEY `product_idx_idx` (`product_idx`),
  KEY `day_of_week_idx` (`day_of_week`),
  KEY `hour_slot_idx` (`hour_slot`),
  CONSTRAINT `mentoring_regular_slots_product_fk` FOREIGN KEY (`product_idx`) REFERENCES `mentoring_products` (`product_idx`) ON DELETE CASCADE,
  CONSTRAINT `day_of_week_check` CHECK (`day_of_week` >= 1 AND `day_of_week` <= 7),
  CONSTRAINT `hour_slot_check` CHECK (`hour_slot` >= 0 AND `hour_slot` <= 23)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='멘토링 정기 스케줄 테이블 (요일별 시간 단위 시간표)';

-- 결제 정보 테이블
DROP TABLE IF EXISTS `payments`;
CREATE TABLE `payments` (
  `payment_id` INT NOT NULL AUTO_INCREMENT COMMENT '결제 고유 ID',
  `user_idx` INT NOT NULL COMMENT '결제자 ID (users 테이블 FK)',
  `product_idx` INT NOT NULL COMMENT '멘토링 상품 ID (mentoring_products 테이블 FK)',
  `amount` DECIMAL(10,0) NOT NULL COMMENT '결제 금액',
  `payment_status` ENUM('pending', 'completed', 'failed', 'cancelled', 'refunded') NOT NULL DEFAULT 'pending' COMMENT '결제 상태',
  `transaction_id` VARCHAR(255) NULL COMMENT '외부 결제 시스템 거래 ID',
  `paid_at` TIMESTAMP NULL COMMENT '결제 완료 시간',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '결제 요청 시간',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
  PRIMARY KEY (`payment_id`),
  KEY `user_idx_idx` (`user_idx`),
  KEY `product_idx_idx` (`product_idx`),
  KEY `payment_status_idx` (`payment_status`),
  CONSTRAINT `payments_user_fk` FOREIGN KEY (`user_idx`) REFERENCES `users` (`idx`) ON DELETE CASCADE,
  CONSTRAINT `payments_product_fk` FOREIGN KEY (`product_idx`) REFERENCES `mentoring_products` (`product_idx`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='결제 정보 테이블';

-- 멘토링 신청 테이블
DROP TABLE IF EXISTS `mentoring_applications`;
CREATE TABLE `mentoring_applications` (
  `application_id` INT NOT NULL AUTO_INCREMENT COMMENT '신청 고유 ID',
  `mentee_idx` INT NOT NULL COMMENT '멘티 ID (users 테이블 FK)',
  `product_idx` INT NOT NULL COMMENT '멘토링 상품 ID (mentoring_products 테이블 FK)',
  `regular_slots_idx` INT NOT NULL COMMENT '선택한 예약 슬롯 ID (regular_slots_idx 테이블 FK)',
  `booked_date` DATE NOT NULL COMMENT '예약일자',
  `payment_id` INT NULL COMMENT '결제 ID (payments 테이블 FK)',
  `message_to_mentor` TEXT NULL COMMENT '멘토에게 보낼 메시지',
  `application_status` ENUM('pending', 'approved', 'rejected', 'completed', 'cancelled') NOT NULL DEFAULT 'pending' COMMENT '신청 상태',
  `rejection_reason` TEXT NULL COMMENT '거절 사유',
  `approved_at` TIMESTAMP NULL COMMENT '승인 시간',
  `rejected_at` TIMESTAMP NULL COMMENT '거절 시간',
  `completed_at` TIMESTAMP NULL COMMENT '완료 시간',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '신청일시',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
  PRIMARY KEY (`application_id`),
  KEY `mentee_idx_idx` (`mentee_idx`),
  KEY `product_idx_idx` (`product_idx`),
  KEY `regular_slots_idx_idx` (`regular_slots_idx`),
  KEY `payment_id_idx` (`payment_id`),
  KEY `application_status_idx` (`application_status`),
  CONSTRAINT `mentoring_applications_mentee_fk` FOREIGN KEY (`mentee_idx`) REFERENCES `users` (`idx`) ON DELETE CASCADE,
  CONSTRAINT `mentoring_applications_product_fk` FOREIGN KEY (`product_idx`) REFERENCES `mentoring_products` (`product_idx`) ON DELETE CASCADE,
  CONSTRAINT `mentoring_applications_slot_fk` FOREIGN KEY (`regular_slots_idx`) REFERENCES `mentoring_regular_slots` (`regular_slots_idx`) ON DELETE CASCADE,
  CONSTRAINT `mentoring_applications_payment_fk` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`payment_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='멘토링 신청 테이블';

-- 멘토링 리뷰 테이블
DROP TABLE IF EXISTS `mentoring_reviews`;
CREATE TABLE `mentoring_reviews` (
  `review_idx` INT NOT NULL AUTO_INCREMENT COMMENT '리뷰 고유 ID',
  `application_id` INT NOT NULL COMMENT '멘토링 신청 ID (mentoring_applications 테이블 FK)',
  `product_idx` INT NOT NULL COMMENT '멘토링 상품 ID (mentoring_products 테이블 FK)',
  `mentee_idx` INT NOT NULL COMMENT '리뷰 작성자 ID (users 테이블 FK)',
  `rating` TINYINT(1) NOT NULL COMMENT '별점 (1~5)',
  `review_content` TEXT NOT NULL COMMENT '리뷰 내용',
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '작성일시',
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
  PRIMARY KEY (`review_idx`),
  KEY `product_idx_idx` (`product_idx`),
  KEY `mentee_idx_idx` (`mentee_idx`),
  KEY `rating_idx` (`rating`),
  CONSTRAINT `mentoring_reviews_application_fk` FOREIGN KEY (`application_id`) REFERENCES `mentoring_applications` (`application_id`) ON DELETE CASCADE,
  CONSTRAINT `mentoring_reviews_product_fk` FOREIGN KEY (`product_idx`) REFERENCES `mentoring_products` (`product_idx`) ON DELETE CASCADE,
  CONSTRAINT `mentoring_reviews_mentee_fk` FOREIGN KEY (`mentee_idx`) REFERENCES `users` (`idx`) ON DELETE CASCADE,
  CONSTRAINT `rating_check` CHECK (`rating` >= 1 AND `rating` <= 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='멘토링 리뷰 테이블';


DROP TABLE IF EXISTS `canvas`;
-- 캔버스 기본 정보
CREATE TABLE canvas (
    id CHAR(36) NOT NULL PRIMARY KEY,          -- UUID (문자열)
    application_id INT NOT NULL,               -- 연결된 멘토링 신청 ID
    name VARCHAR(255) NULL,                    -- 캔버스 이름
    created_by INT NOT NULL,                   -- 캔버스를 만든 유저
    json_data LONGTEXT NULL COMMENT 'Fabric.js 오브젝트 직렬화 상태 저장',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_canvas_user FOREIGN KEY (created_by) 
        REFERENCES users(idx) ON DELETE CASCADE,
    CONSTRAINT fk_canvas_application FOREIGN KEY (application_id) 
        REFERENCES mentoring_applications(application_id) ON DELETE CASCADE,
    UNIQUE KEY uq_canvas_application (application_id)  -- 1:1 관계 보장
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;


DROP TABLE IF EXISTS `canvas_participant`;
-- 캔버스 참여자 정보
CREATE TABLE canvas_participant (
    canvas_id CHAR(36) NOT NULL,        -- 캔버스 ID
    user_id INT NOT NULL,               -- 참여자 유저 ID
    role ENUM('owner','editor','viewer') DEFAULT 'editor',
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (canvas_id, user_id),
    FOREIGN KEY (canvas_id) REFERENCES canvas(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(idx) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;