import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';

// Services
import { SocialService } from './social.service';
import { UserProfileService } from './services/user-profile.service';
import { PostService } from './services/post.service';
import { CommentService } from './services/comment.service';
import { FollowService } from './services/follow.service';

// Controllers
import { UserProfileController } from './controllers/user-profile.controller';
import { PostController } from './controllers/post.controller';
import { CommentController } from './controllers/comment.controller';
import { FollowController } from './controllers/follow.controller';

@Module({
    imports: [DatabaseModule],
    controllers: [
        // Domain Controllers
        UserProfileController,
        PostController,
        CommentController,
        FollowController,
    ],
    providers: [
        // Domain Services
        UserProfileService,
        PostService,
        CommentService,
        FollowService,
        // Facade Service (for backward compatibility)
        SocialService,
    ],
    exports: [
        // Export individual services for potential use in other modules
        UserProfileService,
        PostService,
        CommentService,
        FollowService,
        // Export main facade service
        SocialService,
    ],
})
export class SocialModule {}
