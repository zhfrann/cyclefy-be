import { prismaClient } from "../application/database.js";
import { addressIdOwnershipValidate, phoneIdOwnershipValidate, isCategoryIdValid } from "../helpers/userHelper.js";
import { getPictureUrl } from "../helpers/fileHelper.js";
import { validate } from "../validations/validation.js";
import { createBorrowValidation, processBorrowRequestValidation } from "../validations/borrowValidation.js";
import { ResponseError } from "../errors/responseError.js";
import { snakeToTitleCase } from "../helpers/statusHelper.js";
import { calculateDistance } from "../helpers/geoHelper.js";
import { stat } from "fs";
import { getHost, getProtocol } from "../helpers/httpHelper.js";
import { createNotification } from "./notificationService.js";

const createBorrow = async (userId, requestBody, files, reqObject) => {
    if (!files || !Array.isArray(files) || files.length === 0)
        throw new ResponseError(400, "file.no_file_uploaded");
    // if (files.length > 5)
    //     throw new ResponseError(400, "file.too_many_files");

    const data = validate(createBorrowValidation, requestBody, reqObject);

    // Ownership & validation
    await addressIdOwnershipValidate(userId, data.address_id);
    await phoneIdOwnershipValidate(userId, data.phone_id);
    await isCategoryIdValid(data.category_id);

    const reqFrom = new Date(data.duration_from);
    const reqTo = new Date(data.duration_to);
    reqTo.setHours(23, 59, 59, 999);
    if (reqFrom > reqTo) throw new ResponseError(400, "borrow.invalid_duration");

    // Save borrow
    const borrow = await prismaClient.borrow.create({
        data: {
            user_id: userId,
            item_name: data.item_name,
            description: data.description,
            category_id: data.category_id,
            address_id: data.address_id,
            phone_id: data.phone_id,
            duration_from: new Date(data.duration_from),
            duration_to: new Date(data.duration_to)
        },
        include: { category: true }
    });

    // Save all images
    const imagePaths = [];
    if (files && Array.isArray(files)) {
        for (const file of files) {
            await prismaClient.borrowImage.create({
                data: {
                    borrow_id: borrow.id,
                    image_path: `/assets/borrows/postings/${file.filename}`,
                    image_name: file.originalname,
                    image_size: file.size
                }
            });
            imagePaths.push(getPictureUrl(reqObject, `/assets/borrows/postings/${file.filename}`));
        }
    }

    // Create Borrow Status
    const borrowStatus = await prismaClient.borrowStatusHistory.create({
        data: {
            borrow_id: borrow.id,
            status: "waiting_for_request",
            status_detail: reqObject.__("borrow.posting.waiting_for_request_detail"),
        }
    });

    const host = getHost(reqObject);
    const protocol = getProtocol(reqObject);

    await createNotification({
        userId,
        type: "borrow",
        entityId: borrow.id,
        title: "Borrow - Waiting for Request",
        messageKey: "notification.borrow_waiting_for_request_message",
        messageData: { item_name: borrow.item_name },
        redirectTo: `${protocol}://${host}/api/users/current/borrows/${borrow.id}`
    });

    return {
        id: borrow.id,
        item_name: borrow.item_name,
        description: borrow.description,
        category: {
            id: borrow.category.id,
            name: borrow.category.name
        },
        address_id: borrow.address_id,
        phone_id: borrow.phone_id,
        duration_from: borrow.duration_from,
        duration_to: borrow.duration_to,
        images: imagePaths,
        status: snakeToTitleCase(borrowStatus.status)
    };
};

const getBorrows = async (
    userId, search, category, maxDistance, location, from, to, days, sort, page, size, reqObject
) => {
    // 1. Get all user addresses
    const userAddresses = await prismaClient.address.findMany({ where: { user_id: userId } });
    if (!userAddresses.length) throw new ResponseError(404, "user.no_address");

    // 2. Build where clause
    const where = { user_id: { not: userId } };
    if (category && category.length > 0) {
        where.category = { name: { in: category } };
    }
    if (search) {
        where.OR = [
            { item_name: { contains: search } },
            { description: { contains: search } }
        ];
    }
    // Location filter (city/state/country)
    if (!maxDistance && location) {
        where.OR = [
            ...(where.OR || []),
            { address: { address: { contains: location } } },
        ];
    }
    where.duration_from = { gte: new Date() };

    // 3. Query all borrows
    const borrows = await prismaClient.borrow.findMany({
        where,
        include: {
            address: true,
            category: true,
            user: true,
            borrowStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1  //take last status
            },
            images: true
        }
    });

    // 4. Filter status
    const allowedStatuses = ["waiting_for_request", "waiting_for_confirmation"];
    let filtered = borrows.filter(borrow =>
        borrow.borrowStatusHistories.length > 0 &&
        allowedStatuses.includes(borrow.borrowStatusHistories[0].status)
    );

    // 5. Filter by maxDistance (if set)
    let data = filtered.map(borrow => {
        const distances = userAddresses.map(address => {
            const start = { latitude: address.latitude, longitude: address.longitude };
            const end = { latitude: borrow.address.latitude, longitude: borrow.address.longitude };
            return calculateDistance(start, end);
        });
        const minDistance = Math.min(...distances);
        return {
            ...borrow,
            minDistance
        };
    });
    if (maxDistance && typeof maxDistance === 'number' && !isNaN(maxDistance)) {
        data = data.filter(item => item.minDistance <= maxDistance);
    }

    // 6. Filter by duration
    if (from && to) {
        const fromDate = new Date(from);
        const toDate = new Date(to);
        data = data.filter(item =>
            item.duration_from <= fromDate && item.duration_to >= toDate
        );
    } else if (days && typeof days === 'number' && !isNaN(days)) {
        data = data.filter(item => {
            const duration = (item.duration_to - item.duration_from) / (1000 * 60 * 60 * 24);
            return duration >= days;
        });
    }

    // 7. Mapping final response
    const mapped = data.map(borrow => ({
        id: borrow.id,
        item_name: borrow.item_name,
        description: borrow.description,
        category: {
            id: borrow.category.id,
            name: borrow.category.name,
        },
        address: {
            id: borrow.address.id,
            address: borrow.address.address,
            latitude: borrow.address.latitude,
            longitude: borrow.address.longitude
        },
        distance: borrow.minDistance,
        user: {
            id: borrow.user.id,
            username: borrow.user.username,
            fullname: borrow.user.fullname,
            profile_picture: (!borrow.user.profile_picture?.startsWith("http") && !borrow.user.profile_picture?.startsWith("https"))
                ? getPictureUrl(reqObject, borrow.user.profile_picture)
                : borrow.user.profile_picture,
        },
        images: borrow.images.map(img =>
            (!img.image_path.startsWith("http") && !img.image_path.startsWith("https"))
                ? getPictureUrl(reqObject, img.image_path)
                : img.image_path
        ),
        duration_from: borrow.duration_from,
        duration_to: borrow.duration_to,
        borrowing_duration: (borrow.duration_to - borrow.duration_from) / (1000 * 60 * 60 * 24) + 1,
        created_at: borrow.created_at,
        updated_at: borrow.updated_at
    }));

    // 8. Sorting
    if (sort === "nearest") {
        mapped.sort((a, b) => a.distance - b.distance);
    } else if (sort === "newest") {
        mapped.sort((a, b) => b.created_at - a.created_at);
    } else if (sort === "borrowing_duration") {
        mapped.sort((a, b) => b.borrowing_duration - a.borrowing_duration);
    } // default: relevance

    // 9. Pagination
    const total = mapped.length;
    const paged = mapped.slice((page - 1) * size, page * size);

    return {
        meta: {
            total: total,
            page: page,
            size: size,
            totalPages: Math.ceil(total / size)
        },
        data: paged
    };
};

const getBorrowDetail = async (userId, borrowId, reqObject) => {
    // 1. Ambil data borrow beserta relasi
    const borrow = await prismaClient.borrow.findUnique({
        where: { id: borrowId, user_id: { not: userId } },
        include: {
            address: true,
            category: true,
            user: true,
            phone: true,
            borrowStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1  //take last status
            },
            images: true
        }
    });
    if (!borrow) throw new ResponseError(404, "borrow.not_found");

    // if (borrow.user_id === userId) throw new ResponseError(403, "borrow.forbidden_own_post");

    // 2. Ambil status terakhir
    const statusHistory = borrow.borrowStatusHistories[0] ?? null;

    // 3. Hitung distance (ambil alamat user login, cari yang terdekat)
    const userAddresses = await prismaClient.address.findMany({ where: { user_id: userId } });
    let distance = null;
    if (userAddresses.length > 0) {
        const distances = userAddresses.map(address => {
            const start = { latitude: address.latitude, longitude: address.longitude };
            const end = { latitude: borrow.address.latitude, longitude: borrow.address.longitude };
            return calculateDistance(start, end);
        });
        distance = Math.min(...distances);
    }

    // 4. Mapping response
    return {
        id: borrow.id,
        item_name: borrow.item_name,
        description: borrow.description,
        images: borrow.images.map(img =>
            (!img.image_path.startsWith("http") && !img.image_path.startsWith("https"))
                ? getPictureUrl(reqObject, img.image_path)
                : img.image_path
        ),
        category: borrow.category
            ? { id: borrow.category.id, name: borrow.category.name }
            : null,
        status: statusHistory
            ? {
                id: statusHistory.id,
                status: snakeToTitleCase(statusHistory.status),
                updated_at: statusHistory.updated_at
            }
            : null,
        user: borrow.user
            ? {
                id: borrow.user.id,
                profile_picture: (!borrow.user.profile_picture?.startsWith("http") && !borrow.user.profile_picture?.startsWith("https"))
                    ? getPictureUrl(reqObject, borrow.user.profile_picture)
                    : borrow.user.profile_picture,
                username: borrow.user.username,
                fullname: borrow.user.fullname
            }
            : null,
        address: borrow.address
            ? {
                id: borrow.address.id,
                address: borrow.address.address,
                latitude: borrow.address.latitude,
                longitude: borrow.address.longitude
            }
            : null,
        distance,
        phone: borrow.phone
            ? {
                id: borrow.phone.id,
                number: borrow.phone.number
            }
            : null,
        duration_from: borrow.duration_from,
        duration_to: borrow.duration_to,
        borrowing_duration: (borrow.duration_to - borrow.duration_from) / (1000 * 60 * 60 * 24) + 1
        // created_at: borrow.created_at,
        // updated_at: borrow.updated_at
    };
};

const getMyBorrowDetail = async (userId, borrowId, reqObject) => {
    // 1. Ambil postingan borrow milik user login
    const borrow = await prismaClient.borrow.findUnique({
        where: {
            id: borrowId,
            user_id: userId
        },
        include: {
            images: true,
            category: true,
            address: true,
            borrowStatusHistories: {
                orderBy: { created_at: 'asc' }
            }
        }
    });
    if (!borrow) throw new ResponseError(404, 'borrow.not_found');

    // 2. Ambil semua borrowApplication (request) yang masuk ke postingan borrow ini
    const borrowApplications = await prismaClient.borrowApplication.findMany({
        where: { borrow_id: borrowId },
        include: {
            user: true,
            address: true,
            borrowApplicationStatusHistories: {
                orderBy: { created_at: 'desc' },
                take: 1
            }
        }
    });

    // 3. Ambil address user login untuk hitung distance
    const userAddresses = await prismaClient.address.findMany({ where: { user_id: userId } });

    // 4. Mapping incoming_requests
    const incoming_requests = borrowApplications.map(app => {
        // Hitung distance (min dari semua address user ke address borrow application)
        let distance = null;
        if (userAddresses.length && app.address) {
            const distances = userAddresses.map(addr =>
                calculateDistance(
                    { latitude: addr.latitude, longitude: addr.longitude },
                    { latitude: app.address.latitude, longitude: app.address.longitude }
                )
            );
            distance = Math.min(...distances);
        }

        return {
            id: app.id,
            reason: app.reason,
            address: app.address
                ? {
                    id: app.address.id,
                    name: app.address.address_name,
                    address: app.address.address,
                    latitude: app.address.latitude,
                    longitude: app.address.longitude
                }
                : null,
            distance: distance,
            user: app.user
                ? {
                    id: app.user.id,
                    profile_picture: (!app.user.profile_picture?.startsWith('http') && !app.user.profile_picture?.startsWith('https'))
                        ? getPictureUrl(reqObject, app.user.profile_picture)
                        : app.user.profile_picture,
                    fullname: app.user.fullname,
                    username: app.user.username
                }
                : null,
            status: app.borrowApplicationStatusHistories[0]
                ? {
                    id: app.borrowApplicationStatusHistories[0].id,
                    status: snakeToTitleCase(app.borrowApplicationStatusHistories[0].status),
                    updated_at: app.borrowApplicationStatusHistories[0].updated_at
                }
                : null,
            duration_from: app.duration_from,
            duration_to: app.duration_to,
            borrowing_duration: (app.duration_to - app.duration_from) / (1000 * 60 * 60 * 24) + 1
        };
    });

    // 5. Mapping status_histories
    const status_histories = borrow.borrowStatusHistories.map(status => {
        let statusDetail;

        if (status.status === "extended") {
            const extendedApp = borrowApplications.find((app) => {
                return app.borrowApplicationStatusHistories[0] &&
                    app.borrowApplicationStatusHistories[0].status === "extended"
            });

            let extendedDate = null;
            if (extendedApp) {
                extendedDate = extendedApp.duration_to;
            }

            statusDetail = reqObject.__(status.status_detail, { date: extendedDate });
        } else {
            statusDetail = reqObject.__(status.status_detail)
        }

        return {
            id: status.id,
            status: snakeToTitleCase(status.status),
            status_detail: statusDetail,
            updated_at: status.updated_at
        }
    });

    // 6. Mapping response
    return {
        id: borrow.id,
        item_name: borrow.item_name,
        description: borrow.description,
        category: borrow.category
            ? { id: borrow.category.id, name: borrow.category.name }
            : null,
        images: borrow.images.map(img =>
            (!img.image_path.startsWith('http') && !img.image_path.startsWith('https'))
                ? getPictureUrl(reqObject, img.image_path)
                : img.image_path
        ),
        status: borrow.borrowStatusHistories.length > 0
            ? snakeToTitleCase(borrow.borrowStatusHistories[borrow.borrowStatusHistories.length - 1].status)
            : null,
        status_histories: status_histories,
        address: borrow.address
            ? {
                id: borrow.address.id,
                name: borrow.address.name,
                address: borrow.address.address,
                latitude: borrow.address.latitude,
                longitude: borrow.address.longitude
            }
            : null,
        duration_from: borrow.duration_from,
        duration_to: borrow.duration_to,
        borrowing_duration: (borrow.duration_to - borrow.duration_from) / (1000 * 60 * 60 * 24) + 1,
        incoming_requests: incoming_requests
    };
};

const getMyBorrowIncomingRequestDetail = async (userId, borrowId, requestId, reqObject) => {
    // 1. Pastikan borrowId milik user login
    const borrow = await prismaClient.borrow.findUnique({
        where: { id: borrowId, user_id: userId },
        include: {
            images: true,
            category: true,
            address: true,
            phone: true,
            borrowStatusHistories: { orderBy: { created_at: 'desc' }, take: 1 },
            user: true
        }
    });
    if (!borrow) throw new ResponseError(404, 'borrow.not_found');

    // 2. Ambil borrowApplication (request) spesifik
    const borrowApp = await prismaClient.borrowApplication.findUnique({
        where: { id: requestId },
        include: {
            user: true,
            address: true,
            phone: true,
            borrowApplicationStatusHistories: {
                orderBy: { created_at: 'desc' },
                take: 1
            }
        }
    });
    if (!borrowApp || borrowApp.borrow_id !== borrowId)
        throw new ResponseError(404, 'borrow_application.not_found');

    // 3. Ambil address user login untuk distance
    const userAddresses = await prismaClient.address.findMany({ where: { user_id: userId } });
    let distance = null;
    if (userAddresses.length && borrowApp.address) {
        const distances = userAddresses.map(addr =>
            calculateDistance(
                { latitude: addr.latitude, longitude: addr.longitude },
                { latitude: borrowApp.address.latitude, longitude: borrowApp.address.longitude }
            )
        );
        distance = Math.min(...distances);
    }

    // 4. Mapping requested_by (data requestId)
    const requested_by = {
        id: borrowApp.id,
        reason: borrowApp.reason,
        address: borrowApp.address
            ? {
                id: borrowApp.address.id,
                address: borrowApp.address.address,
                latitude: borrowApp.address.latitude,
                longitude: borrowApp.address.longitude
            }
            : null,
        distance: distance,
        user: borrowApp.user
            ? {
                id: borrowApp.user.id,
                profile_picture: (!borrowApp.user.profile_picture?.startsWith('http') && !borrowApp.user.profile_picture?.startsWith('https'))
                    ? getPictureUrl(reqObject, borrowApp.user.profile_picture)
                    : borrowApp.user.profile_picture,
                fullname: borrowApp.user.fullname,
                username: borrowApp.user.username
            }
            : null,
        status: borrowApp.borrowApplicationStatusHistories[0]
            ? {
                id: borrowApp.borrowApplicationStatusHistories[0].id,
                status: snakeToTitleCase(borrowApp.borrowApplicationStatusHistories[0].status),
                updated_at: borrowApp.borrowApplicationStatusHistories[0].updated_at
            }
            : null,
        phone: borrowApp.phone ? borrowApp.phone.number : null,
        duration_from: borrowApp.duration_from,
        duration_to: borrowApp.duration_to,
        borrowing_duration: (borrowApp.duration_to - borrowApp.duration_from) / (1000 * 60 * 60 * 24) + 1
    };

    // 5. Mapping response
    return {
        id: borrow.id,
        item_name: borrow.item_name,
        description: borrow.description,
        images: borrow.images.map(img =>
            (!img.image_path.startsWith('http') && !img.image_path.startsWith('https'))
                ? getPictureUrl(reqObject, img.image_path)
                : img.image_path
        ),
        category: borrow.category
            ? { id: borrow.category.id, name: borrow.category.name }
            : null,
        status: borrow.borrowStatusHistories[0]
            ? {
                id: borrow.borrowStatusHistories[0].id,
                status: snakeToTitleCase(borrow.borrowStatusHistories[0].status),
                updated_at: borrow.borrowStatusHistories[0].updated_at
            }
            : null,
        user: borrow.user
            ? {
                id: borrow.user.id,
                profile_picture: (!borrow.user.profile_picture?.startsWith('http') && !borrow.user.profile_picture?.startsWith('https'))
                    ? getPictureUrl(reqObject, borrow.user.profile_picture)
                    : borrow.user.profile_picture,
                username: borrow.user.username,
                fullname: borrow.user.fullname
            }
            : null,
        address: borrow.address
            ? {
                id: borrow.address.id,
                address: borrow.address.address,
                latitude: borrow.address.latitude,
                longitude: borrow.address.longitude
            }
            : null,
        phone: borrow.phone ? borrow.phone.number : null,
        duration_from: borrow.duration_from,
        duration_to: borrow.duration_to,
        borrowing_duration: (borrow.duration_to - borrow.duration_from) / (1000 * 60 * 60 * 24) + 1,
        requested_by: requested_by
    };
};

const processIncomingRequest = async (userId, borrowId, requestId, action, decline_reason, reqObject) => {
    validate(processBorrowRequestValidation, { action, decline_reason }, reqObject);

    // 1. Validasi borrowId milik user login
    const borrow = await prismaClient.borrow.findUnique({
        where: { id: borrowId, user_id: userId },
        include: {
            borrowStatusHistories: { orderBy: { created_at: 'desc' }, take: 1 }
        }
    });
    if (!borrow) throw new ResponseError(404, 'borrow.not_found');

    // 2. Validasi status borrowId
    const currentBorrowStatus = borrow.borrowStatusHistories[0];
    if (!currentBorrowStatus || currentBorrowStatus.status !== 'waiting_for_confirmation') {
        throw new ResponseError(400, 'borrow.cannot_confirmed');
    }

    // 3. Ambil borrowApplication (request) spesifik
    const borrowApp = await prismaClient.borrowApplication.findUnique({
        where: { id: requestId },
        include: {
            borrowApplicationStatusHistories: { orderBy: { created_at: 'desc' }, take: 1 }
        }
    });
    if (!borrowApp || borrowApp.borrow_id !== borrowId)
        throw new ResponseError(404, 'borrow_application.not_found');

    // 4. Validasi status requestId
    const currentAppStatus = borrowApp.borrowApplicationStatusHistories[0];
    if (!currentAppStatus || currentAppStatus.status !== 'request_submitted') {
        throw new ResponseError(400, 'borrow_application.cannot_confirmed');
    }

    // 5. Proses action
    if (action === 'decline') {
        // Update status borrowApplication: cancelled
        await prismaClient.borrowApplicationStatusHistory.create({
            data: {
                borrow_application_id: requestId,
                status: 'cancelled',
                status_detail: decline_reason,
                updated_by: userId
            }
        });
        await prismaClient.borrowApplication.update({
            where: { id: requestId },
            data: { decline_reason }
        });
    } else if (action === 'accept') {
        // 1. Update status requestId: confirmed
        await prismaClient.borrowApplicationStatusHistory.create({
            data: {
                borrow_application_id: requestId,
                status: 'confirmed',
                status_detail: 'borrow_application.request.confirmed_detail',
                // updated_by: userId
            }
        });
        // 2. Update status borrow: confirmed
        await prismaClient.borrowStatusHistory.create({
            data: {
                borrow_id: borrowId,
                status: 'confirmed',
                status_detail: 'borrow.posting.confirmed_detail',
                // updated_by: userId
            }
        });
        // 3. Update semua borrowApplication lain (selain requestId) menjadi cancelled
        const otherApps = await prismaClient.borrowApplication.findMany({
            where: {
                borrow_id: borrowId,
                id: { not: requestId }
            },
            include: {
                borrowApplicationStatusHistories: {
                    orderBy: { created_at: 'desc' },
                    take: 1
                }
            }
        });
        for (const app of otherApps) {
            const lastStatus = app.borrowApplicationStatusHistories[0];
            if (lastStatus && lastStatus.status === 'cancelled') continue;

            await prismaClient.borrowApplicationStatusHistory.create({
                data: {
                    borrow_application_id: app.id,
                    status: 'cancelled',
                    status_detail: 'borrow_application.request.failed_auto_detail',
                    // updated_by: userId
                }
            });
            await prismaClient.borrowApplication.update({
                where: { id: app.id },
                data: { decline_reason: 'borrow_application.request.failed_auto_detail' }
            });
        }
    }
};

const markBorrowAsLent = async (userId, borrowId) => {
    // 1. Validasi borrowId milik user login
    const borrow = await prismaClient.borrow.findUnique({
        where: { id: borrowId, user_id: userId },
        include: {
            borrowStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1 //take last status
            }
        }
    });
    if (!borrow) throw new ResponseError(404, "borrow.not_found");

    // 2. Pastikan status terakhir borrow adalah confirmed
    const lastStatus = borrow.borrowStatusHistories[0];
    if (!lastStatus || lastStatus.status !== "confirmed")
        throw new ResponseError(400, "borrow.cannot_mark_lent");

    const lentedApp = await prismaClient.borrowApplication.findFirst({
        where: {
            borrow_id: borrowId,
            borrowApplicationStatusHistories: {
                some: { status: "confirmed" }
            }
        },
        include: {
            borrowApplicationStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1,
            }
        }
    });
    if (!lentedApp || lentedApp.borrowApplicationStatusHistories[0].status === 0) throw new ResponseError(400, "borrow.no_confirmed_application");
    if (!lentedApp || lentedApp.borrowApplicationStatusHistories[0].status !== "confirmed") throw new ResponseError(400, "borrow_application.cannot_mark_lent");

    // 3. Update borrow_status_histories borrowId jadi lent
    await prismaClient.borrowStatusHistory.create({
        data: {
            borrow_id: borrowId,
            status: "lent",
            status_detail: "borrow.posting.lent_detail"
        }
    });

    // 4. Update borrow_application_status_histories requestId jadi borrowed
    await prismaClient.borrowApplicationStatusHistory.create({
        data: {
            borrow_application_id: lentedApp.id,
            status: "borrowed",
            status_detail: "borrow_application.request.borrowed_detail"
        }
    });
};

const markBorrowAsReturned = async (userId, borrowId) => {
    // 1. Validasi borrowId milik user login
    const borrow = await prismaClient.borrow.findUnique({
        where: { id: borrowId, user_id: userId },
        include: {
            borrowStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1 //take last status
            }
        }
    });
    if (!borrow) throw new ResponseError(404, "borrow.not_found");

    // 2. Pastikan status terakhir borrow adalah lent atau overdue
    const lastStatus = borrow.borrowStatusHistories[0];
    if (!lastStatus || (lastStatus.status !== "lent" && lastStatus.status !== "overdue"))
        throw new ResponseError(400, "borrow.cannot_mark_returned");

    const returnedApp = await prismaClient.borrowApplication.findFirst({
        where: {
            borrow_id: borrowId,
            borrowApplicationStatusHistories: {
                some: { status: { in: ["borrowed", "overdue"] } }
            }
        },
        include: {
            borrowApplicationStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1,
            }
        }
    });
    if (!returnedApp || returnedApp.borrowApplicationStatusHistories[0].status === 0) throw new ResponseError(400, "borrow.no_confirmed_application");
    if (!returnedApp ||
        (returnedApp.borrowApplicationStatusHistories[0].status !== "borrowed" && returnedApp.borrowApplicationStatusHistories[0].status !== "overdue")
    ) throw new ResponseError(400, "borrow_application.cannot_mark_returned");

    // 3. Update borrow_status_histories borrowId jadi returned
    await prismaClient.borrowStatusHistory.create({
        data: {
            borrow_id: borrowId,
            status: "returned",
            status_detail: "borrow.posting.returned_detail"
        }
    });

    // 4. Update borrow_application_status_histories requestId jadi completed
    await prismaClient.borrowApplicationStatusHistory.create({
        data: {
            borrow_application_id: returnedApp.id,
            status: "returned",
            status_detail: "borrow_application.request.returned_detail"
        }
    });
};

const markBorrowAsCompleted = async (userId, borrowId, reqObject) => {
    // 1. Validasi borrowId milik user login
    const borrow = await prismaClient.borrow.findUnique({
        where: { id: borrowId, user_id: userId },
        include: {
            borrowStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1 //take last status
            }
        }
    });
    if (!borrow) throw new ResponseError(404, "borrow.not_found");

    // 2. Pastikan status terakhir borrow adalah returned
    const lastStatus = borrow.borrowStatusHistories[0];
    if (!lastStatus || lastStatus.status !== "returned")
        throw new ResponseError(400, "borrow.cannot_mark_completed");

    const returnedApp = await prismaClient.borrowApplication.findFirst({
        where: {
            borrow_id: borrowId,
            borrowApplicationStatusHistories: {
                some: { status: "returned" }
            }
        },
        include: {
            borrowApplicationStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1,
            }
        }
    });
    if (!returnedApp || returnedApp.borrowApplicationStatusHistories[0].status === 0) throw new ResponseError(400, "borrow.no_confirmed_application");
    if (!returnedApp || returnedApp.borrowApplicationStatusHistories[0].status !== "returned") throw new ResponseError(400, "borrow_application.cannot_mark_completed");

    // 3. Update borrow_status_histories borrowId jadi completed
    await prismaClient.borrowStatusHistory.create({
        data: {
            borrow_id: borrowId,
            status: "completed",
            status_detail: "borrow.posting.completed_detail"
        }
    });

    // 4. Update borrow_application_status_histories requestId jadi completed
    await prismaClient.borrowApplicationStatusHistory.create({
        data: {
            borrow_application_id: returnedApp.id,
            status: "completed",
            status_detail: "borrow_application.request.completed_detail"
        }
    });

    const host = getHost(reqObject);
    const protocol = getProtocol(reqObject);

    await createNotification({
        userId: borrow.user_id,
        type: "borrow",
        entityId: borrow.id,
        title: "Borrow - Completed",
        messageKey: "notification.borrow_completed_message",
        redirectTo: `${protocol}://${host}/api/users/current/borrows/${borrow.id}`
    });
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