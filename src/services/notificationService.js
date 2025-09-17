import { prismaClient } from "../application/database.js";
import { ResponseError } from "../errors/responseError.js";

export const createNotification = async ({
    userId,
    type,
    entityId,
    title,
    messageKey,
    messageData,
    redirectTo
}) => {
    return prismaClient.notification.create({
        data: {
            user_id: userId,
            type,
            entity_id: entityId,
            title,
            message_key: messageKey,
            message_data: messageData,
            redirect_to: redirectTo
        },
    });
};

export const getUserNotifications = async ({
    userId,
    type = "all",
    period = "today",
    page = 1,
    size = 10,
    reqObject
}) => {
    const where = { user_id: userId };

    // Filter type
    if (type && type !== "all") {
        where.type = type;
    }

    // Filter period
    const now = new Date();
    let startDate, endDate;
    switch (period) {
        case "yesterday":
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            endDate.setHours(23, 59, 59, 999);
            break;
        case "a week ago":
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            startDate.setHours(0, 0, 0, 0);
            endDate = now;
            break;
        case "a month ago":
            startDate = new Date(now);
            startDate.setMonth(now.getMonth() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = now;
            break;
        case "today":
        default:
            startDate = new Date(now);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setHours(23, 59, 59, 999);
            break;
    }
    where.created_at = { gte: startDate, lte: endDate };

    // Query
    const notificationsData = await prismaClient.notification.findMany({
        where,
        orderBy: { created_at: "desc" },
        skip: (page - 1) * size,
        take: size,
    });

    const notifications = notificationsData.map((notification) => ({
        id: notification.id,
        user_id: notification.user_id,
        type: notification.type,
        entity_id: notification.entity_id,
        title: notification.title,
        message: reqObject.__(notification.message_key, notification.message_data),
        is_read: notification.is_read,
        redirect_to: notification.redirect_to,
        created_at: notification.created_at,
        updated_at: notification.updated_at,
    }));

    // Total count (optional, for pagination)
    const total = await prismaClient.notification.count({ where });

    return { notifications, total };
};


export const markNotificationAsRead = async (notificationId, userId) => {
    return prismaClient.notification.updateMany({
        where: { id: notificationId, user_id: userId },
        data: { is_read: true },
    });
};

export const markAllNotificationsAsRead = async (userId) => {
    return prismaClient.notification.updateMany({
        where: { user_id: userId, is_read: false },
        data: { is_read: true },
    });
};