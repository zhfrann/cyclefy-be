import { prismaClient } from "../application/database.js";
import { addressIdOwnershipValidate, phoneIdOwnershipValidate } from "../helpers/userHelper.js";
import { validate } from "../validations/validation.js";
import { createBorrowApplicationValidation, extendBorrowApplicationValidation } from "../validations/borrowApplicationValidation.js";
import { ResponseError } from "../errors/responseError.js";
import { getHost, getProtocol } from "../helpers/httpHelper.js";
import { createNotification } from "./notificationService.js";

const createBorrowApplication = async (userId, borrowId, requestBody, reqObject) => {
    // 1. Validasi borrowId
    const borrow = await prismaClient.borrow.findUnique({
        where: { id: borrowId },
        include: { borrowStatusHistories: { orderBy: { created_at: "desc" }, take: 1 } }
    });
    if (!borrow) throw new ResponseError(404, "borrow.not_found");
    if (borrow.user_id === userId) throw new ResponseError(403, "borrow_application.cannot_request_own_post");

    // 2. Validasi input
    const data = validate(createBorrowApplicationValidation, requestBody, reqObject);

    // 3. Validasi address & phone milik user login
    await addressIdOwnershipValidate(userId, data.address_id);
    await phoneIdOwnershipValidate(userId, data.phone_id);

    // 4. Validasi duration
    const reqFrom = new Date(data.duration_from);
    const reqTo = new Date(data.duration_to);
    reqTo.setHours(23, 59, 59, 999);
    if (
        reqFrom < borrow.duration_from ||
        reqTo > borrow.duration_to ||
        reqFrom >= reqTo
    ) {
        throw new ResponseError(400, "borrow_application.invalid_duration");
    }

    // 5. Cek duplicate/overlap request aktif
    // const activeStatuses = ["request_submitted", "confirmed", "borrowed", "lent", "overdue"];
    // const existing = await prismaClient.borrowApplication.findFirst({
    //     where: {
    //         borrow_id: borrowId,
    //         user_id: userId,
    //         OR: [
    //             {
    //                 duration_from: { lte: reqTo },
    //                 duration_to: { gte: reqFrom }
    //             }
    //         ],
    //         borrowApplicationStatusHistories: {
    //             some: { status: { in: activeStatuses } }
    //         }
    //     }
    // });
    // if (existing) throw new ResponseError(409, "borrow_application.duplicate_active_request");

    // 6. Buat borrow application
    const borrowApp = await prismaClient.borrowApplication.create({
        data: {
            borrow_id: borrowId,
            user_id: userId,
            reason: data.reason,
            address_id: data.address_id,
            phone_id: data.phone_id,
            duration_from: reqFrom,
            duration_to: reqTo
        }
    });

    // 7. Buat status history
    await prismaClient.borrowApplicationStatusHistory.create({
        data: {
            borrow_application_id: borrowApp.id,
            status: "request_submitted",
            status_detail: "borrow_application.request.request_submitted_detail"
        }
    });

    // 8. Update status borrow jika status terakhir waiting_for_request
    const lastStatus = borrow.borrowStatusHistories[0];
    if (lastStatus && lastStatus.status === "waiting_for_request") {
        await prismaClient.borrowStatusHistory.create({
            data: {
                borrow_id: borrowId,
                status: "waiting_for_confirmation",
                status_detail: "borrow.posting.waiting_for_confirmation_detail"
            }
        });
    }

    const host = getHost(reqObject);
    const protocol = getProtocol(reqObject);

    const applicant = await prismaClient.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            fullname: true,
        }
    });

    await createNotification({
        userId: borrow.user_id,
        type: "borrow",
        entityId: borrow.id,
        title: "Borrow - Waiting for Confirmation",
        messageKey: "notification.borrow_waiting_for_confirmation_message",
        messageData: { applicant_name: applicant.fullname, item_name: borrow.item_name },
        redirectTo: `${protocol}://${host}/api/users/current/borrows/${borrow.id}`
    });

    // 9. Response
    return {
        id: borrowApp.id,
        borrow_id: borrowId,
        reason: borrowApp.reason,
        address_id: borrowApp.address_id,
        phone_id: borrowApp.phone_id,
        duration_from: borrowApp.duration_from,
        duration_to: borrowApp.duration_to,
        status: "Request Submitted"
    };
};

const extendBorrowApplication = async (userId, borrowId, requestId, requestBody, reqObject) => {
    // 1. Validasi input
    const data = validate(extendBorrowApplicationValidation, requestBody, reqObject);

    // 2. Ambil borrow dan pastikan milik user login
    const borrow = await prismaClient.borrow.findUnique({
        where: { id: borrowId },
        include: {
            borrowStatusHistories: { orderBy: { created_at: "desc" }, take: 1 }
        }
    });
    if (!borrow) throw new ResponseError(404, "borrow.not_found");
    if (borrow.user_id !== userId) throw new ResponseError(403, "borrow.forbidden");

    // 3. Status terakhir borrow harus lent/overdue
    const lastBorrowStatus = borrow.borrowStatusHistories[0];
    if (!lastBorrowStatus || !["lent", "overdue"].includes(lastBorrowStatus.status))
        throw new ResponseError(400, "borrow.cannot_extend_status");

    // 4. Ambil borrowApplication (request) dan pastikan milik borrowId
    const borrowApp = await prismaClient.borrowApplication.findUnique({
        where: { id: requestId },
        include: {
            borrowApplicationStatusHistories: { orderBy: { created_at: "desc" }, take: 1 }
        }
    });
    if (!borrowApp) throw new ResponseError(404, "borrow_application.not_found");
    if (borrowApp.borrow_id !== borrowId) throw new ResponseError(404, "borrow_application.not_found");

    // 5. Status terakhir request harus borrowed/overdue
    const lastAppStatus = borrowApp.borrowApplicationStatusHistories[0];
    if (!lastAppStatus || !["borrowed", "overdue"].includes(lastAppStatus.status))
        throw new ResponseError(400, "borrow_application.cannot_extend_status");

    // 6. Validasi duration_to baru
    const prevDurationTo = new Date(borrowApp.duration_to);
    const newDurationTo = new Date(data.duration_to);
    newDurationTo.setHours(23, 59, 59, 999);
    const maxDurationTo = new Date(borrow.duration_to);

    if (newDurationTo <= prevDurationTo)
        throw new ResponseError(400, "borrow_application.invalid_extend_duration");
    if (newDurationTo > maxDurationTo)
        throw new ResponseError(400, "borrow_application.extend_exceed_borrow_duration");

    // 7. Update duration_to pada borrowApplication
    await prismaClient.borrowApplication.update({
        where: { id: requestId },
        data: { duration_to: newDurationTo }
    });

    // 8. Tambahkan status history extended pada borrowApplication
    await prismaClient.borrowApplicationStatusHistory.create({
        data: {
            borrow_application_id: requestId,
            status: "extended",
            status_detail: "borrow_application.request.extended_detail" // i18n key, gunakan {date: dd/mm/yyyy}
        }
    });

    // 9. Tambahkan status history extended pada borrow
    await prismaClient.borrowStatusHistory.create({
        data: {
            borrow_id: borrowId,
            status: "extended",
            status_detail: "borrow.posting.extended_detail" // i18n key, gunakan {date: dd/mm/yyyy}
        }
    });

    // 10. Response
    return {
        id: borrowApp.id,
        borrow_id: borrowId,
        duration_from: borrowApp.duration_from,
        duration_to: newDurationTo,
        status: "extended"
    };
};

export default {
    createBorrowApplication,
    extendBorrowApplication
}