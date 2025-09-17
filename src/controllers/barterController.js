import barterService from "../services/barterService.js";
import fs from "fs/promises";
import { logger } from "../application/logging.js";
import { isRequestParameterNumber } from "../helpers/controllerHelper.js";
import { ResponseError } from "../errors/responseError.js";

const getBarters = async (req, res, next) => {
    try {
        const searchParam = req.query.search ?? "";
        const category = req.query.category && req.query.category !== "all"
            ? req.query.category.split(',').map(category => category.trim()).filter(Boolean)
            : [];
        const maxDistance = Number(req.query.maxDistance);
        const location = req.query.location ?? null;
        const sortBy = req.query.sortBy ?? "relevance"
        const page = parseInt(req.query.page) > 0 ? parseInt(req.query.page) : 1;
        const size = parseInt(req.query.size) > 0 ? parseInt(req.query.size) : 10;
        const userId = req.user.id;

        const result = await barterService.getBarters(userId, searchParam, category, maxDistance, location, sortBy, page, size, req)
        res.status(201).json({
            success: true,
            message: req.__('barter.get_posts_successful'),
            ...result
        });
    } catch (error) {
        next(error);
    }
};

const getBarterDetail = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const barterId = Number(req.params.barterId);
        if (!isRequestParameterNumber(barterId)) throw new ResponseError(400, "barter.id_not_a_number");
        const result = await barterService.getBarterDetail(userId, barterId, req);
        res.status(200).json({
            success: true,
            message: req.__("barter.get_detail_successful"),
            data: result
        });
    } catch (err) {
        next(err);
    }
};

const createBarter = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const files = req.files;
        const result = await barterService.createBarter(userId, req.body, files, req);
        res.status(201).json({
            success: true,
            message: req.__('barter.create_successful'),
            data: result
        });
    } catch (error) {
        // Hapus file jika gagal
        if (req.files && Array.isArray(req.files)) {
            for (const file of req.files) {
                if (file && file.path) {
                    try { await fs.unlink(file.path); } catch (e) { logger.error("Failed to delete uploaded barter image", e); }
                }
            }
        }
        next(error);
    }
};

const getBarterHistory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const search = req.query.search ?? "";

        const category = req.query.category && req.query.category !== "all"
            ? req.query.category.split(',').map(category => category.trim()).filter(Boolean)
            : [];
        const userItemStatus = req.query.userItemStatus && req.query.userItemStatus !== "all"
            ? req.query.userItemStatus.split(',').map(s => s.trim()).filter(Boolean)
            : [];
        const otherItemStatus = req.query.otherItemStatus && req.query.otherItemStatus !== "all"
            ? req.query.otherItemStatus.split(',').map(s => s.trim()).filter(Boolean)
            : [];
        const ownership = req.query.ownership && req.query.ownership !== "all"
            ? req.query.ownership.split(',').map(ownership => ownership.trim()).filter(Boolean)
            : ["my_items", "other_items"];

        const userItemPage = parseInt(req.query.userItemPage) > 0 ? parseInt(req.query.userItemPage) : 1;
        const userItemSize = parseInt(req.query.userItemSize) > 0 ? parseInt(req.query.userItemSize) : 10;

        const otherItemPage = parseInt(req.query.otherItemPage) > 0 ? parseInt(req.query.otherItemPage) : 1;
        const otherItemSize = parseInt(req.query.otherItemSize) > 0 ? parseInt(req.query.otherItemSize) : 10;

        const result = await barterService.getBarterHistory(userId, search, category, userItemStatus, otherItemStatus, ownership, userItemPage, userItemSize, otherItemPage, otherItemSize, req);
        res.status(200).json({
            success: true,
            message: req.__("barter.get_history_successful"),
            ...result
        });
    } catch (err) {
        next(err);
    }
};

const getMyBarterDetail = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const barterId = Number(req.params.barterId);
        if (!isRequestParameterNumber(barterId)) throw new ResponseError(400, "barter.id_not_a_number");
        const result = await barterService.getMyBarterDetail(userId, barterId, req);
        res.status(200).json({
            success: true,
            message: req.__("barter.get_detail_successful"),
            data: result
        });
    } catch (err) {
        next(err);
    }
};

const getMyBarterIncomingRequestDetail = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const barterId = Number(req.params.barterId);
        if (!isRequestParameterNumber(barterId)) throw new ResponseError(400, "barter.id_not_a_number");
        const requestId = Number(req.params.requestId);
        if (!isRequestParameterNumber(requestId)) throw new ResponseError(400, "barter.request_id_not_a_number");
        const result = await barterService.getMyBarterIncomingRequestDetail(userId, barterId, requestId, req);
        res.status(200).json({
            success: true,
            message: req.__("barter.get_incoming_request_detail_successful"),
            data: result
        });
    } catch (err) {
        next(err);
    }
};

const processIncomingRequest = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const barterId = Number(req.params.barterId);
        if (!isRequestParameterNumber(barterId)) throw new ResponseError(400, "barter.id_not_a_number");
        const requestId = Number(req.params.requestId);
        if (!isRequestParameterNumber(requestId)) throw new ResponseError(400, "barter.request_id_not_a_number");
        const { action, decline_reason } = req.body;
        // if (!["accept", "decline"].includes(action))
        //     throw new ResponseError(400, "barter.invalid_action");
        // if (action === "decline" && (!decline_reason || decline_reason.trim() === ""))
        //     throw new ResponseError(400, "barter.decline_reason_required");
        await barterService.processIncomingRequest(userId, barterId, requestId, action, decline_reason, req);
        res.status(200).json({
            success: true,
            message: req.__(action === "accept"
                ? "barter.request_accepted"
                : "barter.request_declined")
        });
    } catch (err) {
        next(err);
    }
};

const markBarterAsCompleted = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const barterId = Number(req.params.barterId);
        if (!isRequestParameterNumber(barterId)) throw new ResponseError(400, "barter.id_not_a_number");
        await barterService.markBarterAsCompleted(userId, barterId, req);
        res.status(200).json({
            success: true,
            message: req.__("barter.mark_completed_successful")
        });
    } catch (err) {
        next(err);
    }
};

export default {
    getBarters,
    getBarterDetail,
    createBarter,
    getBarterHistory,
    getMyBarterDetail,
    getMyBarterIncomingRequestDetail,
    processIncomingRequest,
    markBarterAsCompleted
};