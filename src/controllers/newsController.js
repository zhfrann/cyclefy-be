import { ResponseError } from "../errors/responseError.js";
import { isRequestParameterNumber } from "../helpers/controllerHelper.js";
import newsService from "../services/newsService.js";

const listNews = async (req, res, next) => {
    try {
        const { search = "", orderBy = "newest", page = 1, size = 10 } = req.query;
        const result = await newsService.getNewsList({
            search,
            orderBy,
            page: parseInt(page),
            size: parseInt(size)
        });
        res.status(200).json({
            success: true,
            message: req.__('news.get_list_successful'),
            ...result
        });
    } catch (err) {
        next(err);
    }
};

const detailNews = async (req, res, next) => {
    try {
        const newsId = req.params.newsId;
        if (!isRequestParameterNumber(newsId)) throw new ResponseError(400, 'news.id_not_a_number');
        const result = await newsService.getNewsDetail(newsId);
        res.status(200).json({
            success: true,
            message: req.__('news.get_news_detail_successful'),
            data: result
        });
    } catch (err) {
        next(err);
    }
};

export default {
    listNews,
    detailNews
}