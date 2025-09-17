-- CreateTable
CREATE TABLE `notifications` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `type` ENUM('donation', 'barter', 'borrow', 'recycle', 'repair') NOT NULL,
    `entity_id` INTEGER NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `message_key` VARCHAR(255) NOT NULL,
    `message_data` JSON NOT NULL,
    `is_read` BOOLEAN NOT NULL DEFAULT false,
    `redirect_to` VARCHAR(255) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
