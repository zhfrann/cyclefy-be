import { logger } from "../application/logging.js";
import { ResponseError } from "../errors/responseError.js";
import { isRequestParameterNumber } from "../helpers/controllerHelper.js";
import borrowService from "../services/borrowService.js";
import fs from "fs/promises"

const createBorrow = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const requestBody = req.body;
        const result = await borrowService.createBorrow(userId, requestBody, req.files, req);
        res.status(201).json({
            success: true,
            message: req.__("borrow.create_successful"),
            data: result
        });
    } catch (error) {
        // Hapus file jika gagal
        if (req.files && Array.isArray(req.files)) {
            for (const file of req.files) {
                if (file && file.path) {
                    try { await fs.unlink(file.path); } catch (e) { logger.error("Failed to delete uploaded borrow image", e); }
                }
            }
        }
        next(error);
    }
};

const getBorrows = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const searchParam = req.query.search ?? "";
        const category = req.query.category && req.query.category !== "all"
            ? req.query.category.split(',').map(category => category.trim()).filter(Boolean)
            : [];
        const maxDistance = req.query.maxDistance ? Number(req.query.maxDistance) : null;
        const location = req.query.location ?? null;
        const from = req.query.from ?? null;
        const to = req.query.to ?? null;
        const days = req.query.days ? Number(req.query.days) : null;
        const sortBy = req.query.sortBy ?? "relevance";
        const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
        const size = parseInt(req.query.size) > 0 ? parseInt(req.query.size) : 10;

        const result = await borrowService.getBorrows(
            userId, searchParam, category, maxDistance, location, from, to, days, sortBy, page, size, req
        );
        res.status(200).json({
            success: true,
            message: req.__('borrow.get_posts_successful'),
            ...result
        });
    } catch (error) {
        next(error);
    }
};

const getBorrowDetail = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const borrowId = Number(req.params.borrowId);
        if (!isRequestParameterNumber(borrowId)) throw new ResponseError(400, "borrow.id_not_a_number");
        const result = await borrowService.getBorrowDetail(userId, borrowId, req);
        res.status(200).json({
            success: true,
            message: req.__("borrow.get_detail_successful"),
            data: result
        });
    } catch (err) {
        next(err);
    }
};

const getMyBorrowDetail = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const borrowId = Number(req.params.borrowId);
        if (!isRequestParameterNumber(borrowId)) throw new ResponseError(400, "borrow.id_not_a_number");
        const result = await borrowService.getMyBorrowDetail(userId, borrowId, req);
        res.status(200).json({
            success: true,
            message: req.__('borrow.get_detail_successful'),
            data: result
        });
    } catch (err) {
        next(err);
    }
};

const getMyBorrowIncomingRequestDetail = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const borrowId = Number(req.params.borrowId);
        if (!isRequestParameterNumber(borrowId)) throw new ResponseError(400, "borrow.id_not_a_number");
        const requestId = Number(req.params.requestId);
        if (!isRequestParameterNumber(requestId)) throw new ResponseError(400, "borrow.id_not_a_number");
        const result = await borrowService.getMyBorrowIncomingRequestDetail(userId, borrowId, requestId, req);
        res.status(200).json({
            success: true,
            message: req.__('borrow_application.get_detail_successful'),
            data: result
        });
    } catch (err) {
        next(err);
    }
};

const processIncomingRequest = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const borrowId = Number(req.params.borrowId);
        if (!isRequestParameterNumber(borrowId)) throw new ResponseError(400, "borrow.id_not_a_number");
        const requestId = Number(req.params.requestId);
        if (!isRequestParameterNumber(requestId)) throw new ResponseError(400, "borrow.id_not_a_number");
        const { action, decline_reason } = req.body;
        const result = await borrowService.processIncomingRequest(userId, borrowId, requestId, action, decline_reason, req);
        res.status(200).json({
            success: true,
            message: req.__(action === "accept"
                ? "borrow.request_accepted"
                : "borrow.request_declined")
        });
    } catch (err) {
        next(err);
    }
};

const markBorrowAsLent = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const borrowId = Number(req.params.borrowId);
        if (!isRequestParameterNumber(borrowId)) throw new ResponseError(400, "borrow.id_not_a_number");
        await borrowService.markBorrowAsLent(userId, borrowId);
        res.status(200).json({
            success: true,
            message: req.__("borrow.mark_lent_successful")
        });
    } catch (err) {
        next(err);
    }
};

const markBorrowAsReturned = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const borrowId = Number(req.params.borrowId);
        if (!isRequestParameterNumber(borrowId)) throw new ResponseError(400, "borrow.id_not_a_number");
        await borrowService.markBorrowAsReturned(userId, borrowId);
        res.status(200).json({
            success: true,
            message: req.__("borrow.mark_returned_successful")
        });
    } catch (err) {
        next(err);
    }
};

const markBorrowAsCompleted = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const borrowId = Number(req.params.borrowId);
        if (!isRequestParameterNumber(borrowId)) throw new ResponseError(400, "borrow.id_not_a_number");
        await borrowService.markBorrowAsCompleted(userId, borrowId, req);
        res.status(200).json({
            success: true,
            message: req.__("borrow.mark_completed_successful")
        });
    } catch (err) {
        next(err);
    }
};

export default {
    createBorrow,
    getBorrows,
    getBorrowDetail,
    getMyBorrowDetail,
    getMyBorrowIncomingRequestDetail,
    processIncomingRequest,
    markBorrowAsLent,
    markBorrowAsReturned,
    markBorrowAsCompleted
};