// src/controllers/notificationController.js

import { ResponseError } from "../errors/responseError.js";
import { isRequestParameterNumber } from "../helpers/controllerHelper.js";
import { getUserNotifications, markNotificationAsRead, markAllNotificationsAsRead } from "../services/notificationService.js";

const getNotifications = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { type = "all", period = "today", page = 1, size = 10 } = req.query;

        const typeValues = ["all", "donation", "barter", "borrow", "repair", "recycle"];
        if (!typeValues.includes(type)) throw new ResponseError(400, 'notification.type_invalid');

        const result = await getUserNotifications({
            userId,
            type,
            period,
            page: parseInt(page),
            size: parseInt(size),
            reqObject: req
        });
        res.status(200).json({
            success: true,
            message: req.__('notification.get_all_successful'),
            ...result,
        });
    } catch (err) {
        next(err);
    }
};

const readNotification = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const notificationId = Number(req.params.notificationId);
        if (!isRequestParameterNumber(notificationId)) throw new ResponseError(400, 'notification.id_not_a_number');
        const result = await markNotificationAsRead(notificationId, userId);
        if (result.count <= 0) throw new ResponseError(404, 'notification.not_found');
        res.status(200).json({
            success: true,
            message: req.__('notification.mark_as_read_successful'),
            data: result
        });
    } catch (err) {
        next(err);
    }
};


const readAllNotifications = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const result = await markAllNotificationsAsRead(userId);
        res.status(200).json({
            success: true,
            message: req.__('notification.mark_all_as_read_successful'),
            data: result
        });
    } catch (err) {
        next(err);
    }
};

export default {
    getNotifications,
    readNotification,
    readAllNotifications
}