import { faker } from '@faker-js/faker';
import { getRandomNewsImageUrl } from './helper/newsSeederHelper.js';

export default async function newsSeeder(prisma) {
    const adminId = 5; // user_id admin dari userSeeder
    const newsCount = 10;

    for (let i = 0; i < newsCount; i++) {
        const title = faker.lorem.sentence(6);
        const content = faker.lorem.paragraphs(3);

        // Create news
        const news = await prisma.news.create({
            data: {
                user_id: adminId,
                title,
                content,
            }
        });

        // Create 1-3 images per news
        const imageCount = Math.floor(Math.random() * 3) + 1;
        for (let j = 0; j < imageCount; j++) {
            await prisma.newsImage.create({
                data: {
                    news_id: news.id,
                    image_path: getRandomNewsImageUrl(),
                    image_name: `news-image-${i + 1}-${j + 1}.jpg`,
                    image_size: 0 // Unknown for dummy url
                }
            });
        }
    }
}