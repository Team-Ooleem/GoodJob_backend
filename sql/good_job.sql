-- MySQL dump 10.13  Distrib 8.0.43, for Win64 (x86_64)
--
-- Host: localhost    Database: good_job
-- ------------------------------------------------------
-- Server version	8.0.43

-- 데이터베이스 생성 (이미 존재하는 경우 무시)
CREATE DATABASE IF NOT EXISTS `good_job_test` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `good_job_test`;

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

-- =====================================================
-- 1단계: 독립적인 테이블들 (외래키가 없는 테이블)
-- =====================================================

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `idx` int NOT NULL AUTO_INCREMENT COMMENT '고유값',
  `name` varchar(45) NOT NULL COMMENT '사용자 이름',
  `phone` varchar(45) NOT NULL COMMENT '사용자 핸드폰번호',
  `email` varchar(45) NOT NULL COMMENT '사용자 이메일',
  `short_bio` varchar(100) DEFAULT NULL COMMENT '짧은 소개',
  `bio` text COMMENT '소개\n',
  `created_at` datetime NOT NULL COMMENT '생성일',
  `update_at` datetime DEFAULT NULL COMMENT '수정일',
  PRIMARY KEY (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='공통 유저 정보 테이블 입니다.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sido`
--

DROP TABLE IF EXISTS `sido`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sido` (
  `sido_code` char(2) NOT NULL,
  `sido_name` varchar(50) NOT NULL,
  PRIMARY KEY (`sido_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `career_type`
--

DROP TABLE IF EXISTS `career_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `career_type` (
  `idx` int NOT NULL AUTO_INCREMENT,
  `code` varchar(10) NOT NULL,
  `name` varchar(20) NOT NULL,
  PRIMARY KEY (`idx`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `education_level`
--

DROP TABLE IF EXISTS `education_level`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `education_level` (
  `idx` int NOT NULL AUTO_INCREMENT,
  `code` varchar(10) NOT NULL,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`idx`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employment_type`
--

DROP TABLE IF EXISTS `employment_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employment_type` (
  `idx` int NOT NULL AUTO_INCREMENT,
  `code` varchar(16) NOT NULL,
  `name` varchar(50) NOT NULL,
  `description` varchar(200) DEFAULT NULL,
  PRIMARY KEY (`idx`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `company_type`
--

DROP TABLE IF EXISTS `company_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `company_type` (
  `id` char(2) NOT NULL,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `corporate_entity`
--

DROP TABLE IF EXISTS `corporate_entity`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `corporate_entity` (
  `idx` int NOT NULL AUTO_INCREMENT,
  `code` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`idx`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `foreign_affiliation`
--

DROP TABLE IF EXISTS `foreign_affiliation`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `foreign_affiliation` (
  `idx` int NOT NULL AUTO_INCREMENT,
  `code` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`idx`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `institution_type`
--

DROP TABLE IF EXISTS `institution_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `institution_type` (
  `idx` int NOT NULL AUTO_INCREMENT,
  `code` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`idx`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `legal_structure`
--

DROP TABLE IF EXISTS `legal_structure`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `legal_structure` (
  `idx` int NOT NULL AUTO_INCREMENT,
  `code` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  PRIMARY KEY (`idx`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `job_category`
--

DROP TABLE IF EXISTS `job_category`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_category` (
  `id` char(2) NOT NULL,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resume`
--

DROP TABLE IF EXISTS `resume`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resume` (
  `resume_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`resume_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `posts`
--

DROP TABLE IF EXISTS `posts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `posts` (
  `post_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `content` text,
  `media_url` varchar(500) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`post_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `posts_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

-- =====================================================
-- 2단계: 1차 의존 테이블들 (독립적인 테이블을 참조하는 테이블)
-- =====================================================

--
-- Table structure for table `gu`
--

DROP TABLE IF EXISTS `gu`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `gu` (
  `gu_code` char(5) NOT NULL,
  `gu_name` varchar(50) NOT NULL,
  `sido_code` char(2) NOT NULL,
  PRIMARY KEY (`gu_code`),
  KEY `ix_gu_sido` (`sido_code`),
  CONSTRAINT `fk_gu_sido` FOREIGN KEY (`sido_code`) REFERENCES `sido` (`sido_code`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `companies`
--

DROP TABLE IF EXISTS `companies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `companies` (
  `idx` int NOT NULL AUTO_INCREMENT COMMENT '고유키',
  `ceo_name` varchar(45) NOT NULL COMMENT '대표 이름',
  `business_number` varchar(45) NOT NULL COMMENT '사업자 번호',
  `business_certificate_img_name` varchar(255) NOT NULL COMMENT '사업자 등록 증명서 사진 이름',
  `company_size_code` char(2) NOT NULL COMMENT '기업 형태 ( 대기업, 중소기업,중견기업)',
  `homepage` varchar(255) DEFAULT NULL COMMENT '홈페이지 주소',
  `logo_img_name` varchar(45) DEFAULT NULL COMMENT '기업 로고 이미지 이름',
  `benefits` text COMMENT '복리후생',
  `is_certificated` tinyint NOT NULL DEFAULT '0' COMMENT '병역 특례인증 업체 인증 여부',
  `is_export` tinyint NOT NULL DEFAULT '0' COMMENT '수출 기업 여부',
  `foreign_affiliation` int NOT NULL DEFAULT '0' COMMENT '외국계 기업 여부',
  `legal_structure` int NOT NULL DEFAULT '0' COMMENT '법률 여부',
  `corporate_entity` int NOT NULL DEFAULT '0' COMMENT '법인 여부',
  `institution_type` int NOT NULL DEFAULT '0' COMMENT '기관 여부',
  `bio` text COMMENT '기업 소개',
  `vision` text COMMENT '기업 비젼',
  PRIMARY KEY (`idx`),
  KEY `company_size_code_idx` (`company_size_code`),
  KEY `foreign_affiliation_idx` (`foreign_affiliation`),
  KEY `legal_structure_idx` (`legal_structure`),
  KEY `corporate_entity_idx` (`corporate_entity`),
  KEY `institution_type_idx` (`institution_type`),
  CONSTRAINT `company_size_code` FOREIGN KEY (`company_size_code`) REFERENCES `company_type` (`id`),
  CONSTRAINT `corporate_entity` FOREIGN KEY (`corporate_entity`) REFERENCES `corporate_entity` (`idx`),
  CONSTRAINT `foreign_affiliation` FOREIGN KEY (`foreign_affiliation`) REFERENCES `foreign_affiliation` (`idx`),
  CONSTRAINT `institution_type` FOREIGN KEY (`institution_type`) REFERENCES `institution_type` (`idx`),
  CONSTRAINT `legal_structure` FOREIGN KEY (`legal_structure`) REFERENCES `legal_structure` (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='기업 리스트';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `job_group`
--

DROP TABLE IF EXISTS `job_group`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_group` (
  `id` char(4) NOT NULL,
  `category_id` char(2) NOT NULL,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `category_id` (`category_id`),
  CONSTRAINT `job_group_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `job_category` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `business_profile`
--

DROP TABLE IF EXISTS `business_profile`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `business_profile` (
  `user_idx` int NOT NULL COMMENT 'users 테이블을 참조하는 참조키',
  `business_number` char(10) NOT NULL COMMENT '사업자 등록번호',
  `business_certificate_img_name` varchar(255) NOT NULL COMMENT '사업자 등록 증명원 url 이름',
  `company_name` varchar(255) NOT NULL COMMENT '회사 이름',
  `company_intro` text NOT NULL COMMENT '회사 소개',
  `id` varchar(45) NOT NULL,
  `password` varchar(45) NOT NULL,
  `ceo_name` varchar(45) NOT NULL,
  `address` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`user_idx`),
  UNIQUE KEY `business_number_UNIQUE` (`business_number`),
  CONSTRAINT `bp_user_idx` FOREIGN KEY (`user_idx`) REFERENCES `users` (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='기업회원 정보입니다.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `individual_profile`
--

DROP TABLE IF EXISTS `individual_profile`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `individual_profile` (
  `user_idx` int NOT NULL COMMENT 'users 테이블 참조키',
  `desired_job` char(6) NOT NULL COMMENT '희망직군',
  `desired_sido` char(2) NOT NULL COMMENT '희망 근무지역',
  `desired_salary` int NOT NULL COMMENT '희망 연봉',
  `desired_gu` char(5) NOT NULL,
  PRIMARY KEY (`user_idx`),
  KEY `desired_sido_idx` (`desired_sido`),
  KEY `desired_gu_idx` (`desired_gu`),
  CONSTRAINT `desired_gu` FOREIGN KEY (`desired_gu`) REFERENCES `gu` (`gu_code`),
  CONSTRAINT `desired_sido` FOREIGN KEY (`desired_sido`) REFERENCES `sido` (`sido_code`),
  CONSTRAINT `ip_user_idx` FOREIGN KEY (`user_idx`) REFERENCES `users` (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='개인회원 정보입니다.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `educate`
--

DROP TABLE IF EXISTS `educate`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `educate` (
  `idx` int NOT NULL AUTO_INCREMENT,
  `user_idx` int NOT NULL,
  `school_name` varchar(255) NOT NULL COMMENT '학교명',
  `major` varchar(255) NOT NULL,
  `degree` int NOT NULL COMMENT '학위',
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `is_current` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`idx`),
  KEY `educate_degree_idx_idx` (`degree`),
  KEY `educate_user_idx_idx` (`user_idx`),
  CONSTRAINT `educate_degree_idx` FOREIGN KEY (`degree`) REFERENCES `education_level` (`idx`),
  CONSTRAINT `educate_user_idx` FOREIGN KEY (`user_idx`) REFERENCES `users` (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='학력테이블';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `follow`
--

DROP TABLE IF EXISTS `follow`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `follow` (
  `idx` int NOT NULL AUTO_INCREMENT,
  `follower_idx` int NOT NULL COMMENT '팔로워',
  `following_idx` int NOT NULL COMMENT '팔로잉',
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`idx`),
  KEY `follow_user_idx_idx` (`follower_idx`),
  KEY `following_user_idx_idx` (`following_idx`),
  CONSTRAINT `follow_user_idx` FOREIGN KEY (`follower_idx`) REFERENCES `users` (`idx`),
  CONSTRAINT `following_user_idx` FOREIGN KEY (`following_idx`) REFERENCES `users` (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='팔로우';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `messages`
--

DROP TABLE IF EXISTS `messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `messages` (
  `message_id` int NOT NULL AUTO_INCREMENT,
  `sender_id` int NOT NULL,
  `receiver_id` int NOT NULL,
  `content` text NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`message_id`),
  KEY `sender_id` (`sender_id`),
  KEY `receiver_id` (`receiver_id`),
  CONSTRAINT `messages_ibfk_1` FOREIGN KEY (`sender_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE,
  CONSTRAINT `messages_ibfk_2` FOREIGN KEY (`receiver_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `social_accout`
--

DROP TABLE IF EXISTS `social_accout`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `social_accout` (
  `user_idx` int NOT NULL COMMENT '유저정보',
  `provider_id` varchar(255) NOT NULL COMMENT '서비스토큰',
  `created_at` datetime DEFAULT NULL,
  KEY `social_user_idx_idx` (`user_idx`),
  CONSTRAINT `social_user_idx` FOREIGN KEY (`user_idx`) REFERENCES `users` (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='소셜로그인';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resume_career`
--

DROP TABLE IF EXISTS `resume_career`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resume_career` (
  `career_id` int NOT NULL AUTO_INCREMENT,
  `resume_id` int NOT NULL,
  `company_name` varchar(255) NOT NULL,
  `position` varchar(45) NOT NULL,
  `is_current` tinyint(1) NOT NULL DEFAULT '0',
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `description` text,
  PRIMARY KEY (`career_id`),
  KEY `resume_id` (`resume_id`),
  CONSTRAINT `resume_career_ibfk_1` FOREIGN KEY (`resume_id`) REFERENCES `resume` (`resume_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resume_coverletter`
--

DROP TABLE IF EXISTS `resume_coverletter`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resume_coverletter` (
  `coverletter_id` int NOT NULL AUTO_INCREMENT,
  `resume_id` int NOT NULL,
  `coverletter_title` varchar(255) DEFAULT NULL,
  `description` text,
  PRIMARY KEY (`coverletter_id`),
  KEY `resume_id` (`resume_id`),
  CONSTRAINT `resume_coverletter_ibfk_1` FOREIGN KEY (`resume_id`) REFERENCES `resume` (`resume_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resume_education`
--

DROP TABLE IF EXISTS `resume_education`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resume_education` (
  `education_id` int NOT NULL AUTO_INCREMENT,
  `resume_id` int NOT NULL,
  `school_name` varchar(255) NOT NULL,
  `major` varchar(100) NOT NULL,
  `degree` varchar(100) NOT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `is_current` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`education_id`),
  KEY `resume_id` (`resume_id`),
  CONSTRAINT `resume_education_ibfk_1` FOREIGN KEY (`resume_id`) REFERENCES `resume` (`resume_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resume_experience`
--

DROP TABLE IF EXISTS `resume_experience`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resume_experience` (
  `experience_id` int NOT NULL AUTO_INCREMENT,
  `resume_id` int NOT NULL,
  `experience_name` varchar(100) NOT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `description` text,
  PRIMARY KEY (`experience_id`),
  KEY `resume_id` (`resume_id`),
  CONSTRAINT `resume_experience_ibfk_1` FOREIGN KEY (`resume_id`) REFERENCES `resume` (`resume_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resume_portfolio`
--

DROP TABLE IF EXISTS `resume_portfolio`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resume_portfolio` (
  `portfolio_id` int NOT NULL AUTO_INCREMENT,
  `resume_id` int NOT NULL,
  `link` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`portfolio_id`),
  KEY `resume_id` (`resume_id`),
  CONSTRAINT `resume_portfolio_ibfk_1` FOREIGN KEY (`resume_id`) REFERENCES `resume` (`resume_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `resume_skill`
--

DROP TABLE IF EXISTS `resume_skill`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `resume_skill` (
  `skill_id` int NOT NULL AUTO_INCREMENT,
  `resume_id` int NOT NULL,
  `skill_name` varchar(100) NOT NULL,
  PRIMARY KEY (`skill_id`),
  KEY `resume_id` (`resume_id`),
  CONSTRAINT `resume_skill_ibfk_1` FOREIGN KEY (`resume_id`) REFERENCES `resume` (`resume_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `post_comments`
--

DROP TABLE IF EXISTS `post_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `post_comments` (
  `comment_id` int NOT NULL AUTO_INCREMENT,
  `post_id` int NOT NULL,
  `user_id` int NOT NULL,
  `content` text NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`comment_id`),
  KEY `post_id` (`post_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `post_comments_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`post_id`) ON DELETE CASCADE,
  CONSTRAINT `post_comments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `post_likes`
--

DROP TABLE IF EXISTS `post_likes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `post_likes` (
  `like_id` int NOT NULL AUTO_INCREMENT,
  `post_id` int NOT NULL,
  `user_id` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`like_id`),
  UNIQUE KEY `unique_like` (`post_id`,`user_id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `post_likes_ibfk_1` FOREIGN KEY (`post_id`) REFERENCES `posts` (`post_id`) ON DELETE CASCADE,
  CONSTRAINT `post_likes_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`idx`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

-- =====================================================
-- 3단계: 2차 의존 테이블들 (1차 의존 테이블을 참조하는 테이블)
-- =====================================================

--
-- Table structure for table `job_role`
--

DROP TABLE IF EXISTS `job_role`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_role` (
  `id` char(6) NOT NULL,
  `group_id` char(4) NOT NULL,
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `group_id` (`group_id`),
  CONSTRAINT `job_role_ibfk_1` FOREIGN KEY (`group_id`) REFERENCES `job_group` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `career`
--

DROP TABLE IF EXISTS `career`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `career` (
  `idx` int NOT NULL AUTO_INCREMENT,
  `user_idx` int NOT NULL,
  `company_idx` int NOT NULL,
  `position` varchar(45) NOT NULL,
  `is_current` tinyint NOT NULL,
  `description` text NOT NULL,
  `department` varchar(100) NOT NULL,
  `job_title` varchar(100) DEFAULT NULL,
  `start_date` datetime NOT NULL,
  `end_date` datetime DEFAULT NULL,
  `carrercol` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`idx`),
  KEY `career_business_number_idx` (`company_idx`),
  CONSTRAINT `career_business_number` FOREIGN KEY (`company_idx`) REFERENCES `companies` (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `job_post`
--

DROP TABLE IF EXISTS `job_post`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_post` (
  `idx` int NOT NULL AUTO_INCREMENT,
  `business_number` varchar(45) NOT NULL,
  `title` varchar(45) NOT NULL,
  `employment_type` int NOT NULL,
  `career_required` int NOT NULL,
  `education_required` int NOT NULL,
  `salary` varchar(45) NOT NULL,
  `location_sido` char(2) NOT NULL,
  `location_gu` char(5) NOT NULL,
  `work_hours` varchar(45) NOT NULL,
  `benefit` text NOT NULL,
  `workplace_location` varchar(45) NOT NULL,
  `apply_deadline` datetime NOT NULL,
  `apply_method` varchar(45) NOT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`idx`),
  KEY `location_sido_idx` (`location_sido`),
  KEY `loacation_gu_idx` (`location_gu`),
  KEY `user_career_type_idx` (`career_required`),
  KEY `user_education_level_idx` (`education_required`),
  KEY `job_employment_type_idx` (`employment_type`),
  CONSTRAINT `job_employment_type` FOREIGN KEY (`employment_type`) REFERENCES `employment_type` (`idx`),
  CONSTRAINT `loacation_gu` FOREIGN KEY (`location_gu`) REFERENCES `gu` (`gu_code`),
  CONSTRAINT `location_sido` FOREIGN KEY (`location_sido`) REFERENCES `sido` (`sido_code`),
  CONSTRAINT `user_career_type` FOREIGN KEY (`career_required`) REFERENCES `career_type` (`idx`),
  CONSTRAINT `user_education_level` FOREIGN KEY (`education_required`) REFERENCES `education_level` (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

-- =====================================================
-- 4단계: 3차 의존 테이블들 (2차 의존 테이블을 참조하는 테이블)
-- =====================================================

--
-- Table structure for table `job_application`
--

DROP TABLE IF EXISTS `job_application`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_application` (
  `idx` int NOT NULL AUTO_INCREMENT COMMENT '인덱스',
  `user_idx` int NOT NULL COMMENT '사용자 인덱스',
  `job_post_idx` int NOT NULL COMMENT '채용공고 인덱스',
  `is_viewed` tinyint NOT NULL COMMENT '지원회사의 열람 여부',
  `created_at` datetime NOT NULL COMMENT '지원일 (생성일)',
  PRIMARY KEY (`idx`),
  KEY `job_application_user_idx_idx` (`user_idx`),
  KEY `job_application_post_idx_idx` (`job_post_idx`),
  CONSTRAINT `job_application_post_idx` FOREIGN KEY (`job_post_idx`) REFERENCES `job_post` (`idx`),
  CONSTRAINT `job_application_user_idx` FOREIGN KEY (`user_idx`) REFERENCES `users` (`idx`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2025-09-01 11:12:08
