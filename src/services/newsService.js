import { prismaClient } from "../application/database.js";
import { getPictureUrl } from "../helpers/fileHelper.js";

const getNewsList = async ({ search = "", orderBy = "newest", page = 1, size = 10 }) => {
    const where = {};
    if (search) {
        where.title = { contains: search, mode: "insensitive" };
    }
    const order = orderBy === "oldest"
        ? { created_at: "asc" }
        : { created_at: "desc" };

    const [total, news] = await Promise.all([
        prismaClient.news.count({ where }),
        prismaClient.news.findMany({
            where,
            orderBy: order,
            skip: (page - 1) * size,
            take: size,
            include: { images: true, user: { select: { id: true, fullname: true, username: true } } }
        })
    ]);

    return {
        meta: {
            total,
            page,
            size,
            totalPages: Math.ceil(total / size)
        },
        data: news.map(n => ({
            id: n.id,
            title: n.title,
            content: n.content.slice(0, 200) + (n.content.length > 200 ? "..." : ""),
            created_at: n.created_at,
            author: n.user,
            images: n.images.map(img => (
                (!img.image_path.startsWith('http')) || !img.image_path.startsWith('https')
                    ? getPictureUrl(img.image_path)
                    : img.image_path
            )),
            updated_at: n.updated_at
        }))
    };
};

const getNewsDetail = async (id) => {
    const news = await prismaClient.news.findUnique({
        where: { id: Number(id) },
        include: { images: true, user: { select: { id: true, fullname: true, username: true } } }
    });
    if (!news) throw new ResponseError(404, "news.not_found");
    return {
        id: news.id,
        title: news.title,
        content: news.content,
        author: news.user,
        images: news.images.map(img => (
            (!img.image_path.startsWith('http')) || !img.image_path.startsWith('https')
                ? getPictureUrl(img.image_path)
                : img.image_path
        )),
        updated_at: news.updated_at,
    };
};

export default {
    getNewsList,
    getNewsDetail
}