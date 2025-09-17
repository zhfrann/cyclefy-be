import { validate } from "../validations/validation.js";
import { createBarterValidation, processBarterRequestValidation } from "../validations/barterValidation.js";
import { addressIdOwnershipValidate, phoneIdOwnershipValidate, isCategoryIdValid } from "../helpers/userHelper.js";
import { prismaClient } from "../application/database.js";
import { getPictureUrl } from "../helpers/fileHelper.js";
import { ResponseError } from "../errors/responseError.js";
import { calculateDistance } from "../helpers/geoHelper.js";
import { snakeToTitleCase } from "../helpers/statusHelper.js";
import { getHost, getProtocol } from "../helpers/httpHelper.js";
import { createNotification } from "./notificationService.js";

const getBarters = async (userId, search, category, maxDistance, location, sort, page, size, reqObject) => {
    // Get all current user addresses
    const userAddresses = await prismaClient.address.findMany({
        where: { user_id: userId }
    });
    if (!userAddresses.length) throw new ResponseError(404, "user.no_address");

    // Get Other user barter posts query
    const where = {
        user_id: { not: userId }
    };
    if (category && category.length > 0) {
        where.category = { name: { in: category } };
    }
    if (search) {
        where.OR = [
            { item_name: { contains: search } },
            { description: { contains: search } },
            // { category: { name: { contains: search} } }
        ];
    }
    if (!maxDistance && location) {
        where.OR = [
            ...(where.OR || []),
            { address: { address: { contains: location } } },
        ];
    }

    // Get other user barter posts
    const barters = await prismaClient.barter.findMany({
        where: {
            ...where,
        },
        include: {
            address: true,
            category: true,
            user: true,
            barterStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1 //take last status
            },
            images: true
        }
    });

    // Filter status
    const allowedStatuses = ["waiting_for_request", "waiting_for_confirmation"];
    let filtered = barters.filter(barter =>
        barter.barterStatusHistories.length > 0 &&
        allowedStatuses.includes(barter.barterStatusHistories[0].status)
    );

    // Count minimun distance to all current user addresses & mapping data
    const data = filtered.map(barter => {
        const distances = userAddresses.map(address => {
            const start = { latitude: address.latitude, longitude: address.longitude }
            const end = { latitude: barter.address.latitude, longitude: barter.address.longitude }
            return calculateDistance(start, end);
        });
        const minDistance = Math.min(...distances);
        return {
            id: barter.id,
            item_name: barter.item_name,
            description: barter.description,
            category: {
                id: barter.category.id,
                name: barter.category.name,
            },
            address: {
                id: barter.address.id,
                address: barter.address.address,
                latitude: barter.address.latitude,
                longitude: barter.address.longitude
            },
            distance: minDistance,
            user: {
                id: barter.user.id,
                username: barter.user.username,
                fullname: barter.user.fullname,
                profile_picture: (!barter.user.profile_picture?.startsWith("http") && !barter.user.profile_picture?.startsWith("https"))
                    ? getPictureUrl(reqObject, barter.user.profile_picture)
                    : barter.user.profile_picture,
            },
            images: barter.images.map(img =>
                (!img.image_path.startsWith("http") && !img.image_path.startsWith("https"))
                    ? getPictureUrl(reqObject, img.image_path)
                    : img.image_path),
            // created_at: barter.created_at,
            // updated_at: barter.updated_at
        }
    });

    let filteredByDistance = data;
    // Filter data by maxDistance if exists
    if (maxDistance && typeof maxDistance === 'number') {
        filteredByDistance = data.filter(item => item.distance <= maxDistance);
    }

    // Sorting data
    if (sort === "nearest") {
        filteredByDistance.sort((a, b) => a.distance - b.distance);
    } else if (sort === "newest") {
        // filtered.sort((a, b) => b.id - a.id);
        filteredByDistance.sort((a, b) => b.created_at - a.created_at);
    } //sort by relevance = default sort


    // Pagination
    const total = filteredByDistance.length;
    const paged = filteredByDistance.slice((page - 1) * size, page * size);
    // const total = filtered.length;

    return {
        meta: {
            total: total,
            page: page,
            size: size,
            totalPages: Math.ceil(total / size)
        },
        data: paged
    }
}

const getBarterDetail = async (userId, barterId, reqObject) => {
    // Get barter data
    const barter = await prismaClient.barter.findUnique({
        where: {
            id: barterId,
            user_id: { not: userId }
        },
        include: {
            images: true,
            category: true,
            barterStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1  //take last status
            },
            user: true,
            address: true,
            phone: true
        }
    });
    if (!barter) throw new ResponseError(404, "barter.not_found");

    // Calculate distance
    let distance = null;
    const userAddresses = await prismaClient.address.findMany({ where: { user_id: userId } });
    if (userAddresses.length && barter.address) {
        const distances = userAddresses.map(addr =>
            calculateDistance(
                { latitude: addr.latitude, longitude: addr.longitude },
                { latitude: barter.address.latitude, longitude: barter.address.longitude }
            )
        );
        distance = Math.min(...distances);
    }

    // Mapping response
    return {
        id: barter.id,
        item_name: barter.item_name,
        description: barter.description,
        images: barter.images.map(img =>
            (!img.image_path.startsWith("http") && !img.image_path.startsWith("https"))
                ? getPictureUrl(reqObject, img.image_path)
                : img.image_path
        ),
        category: barter.category
            ? { id: barter.category.id, name: barter.category.name }
            : null,
        status: barter.barterStatusHistories[0]
            ? {
                id: barter.barterStatusHistories[0].id,
                status: snakeToTitleCase(barter.barterStatusHistories[0].status),
                updated_at: barter.barterStatusHistories[0].updated_at
            }
            : null,
        user: barter.user
            ? {
                id: barter.user.id,
                profile_picture: (!barter.user.profile_picture?.startsWith("http") && !barter.user.profile_picture?.startsWith("https"))
                    ? getPictureUrl(reqObject, barter.user.profile_picture)
                    : barter.user.profile_picture,
                username: barter.user.username,
                fullname: barter.user.fullname
            }
            : null,
        address: barter.address
            ? {
                id: barter.address.id,
                address: barter.address.address,
                latitude: barter.address.latitude,
                longitude: barter.address.longitude
            }
            : null,
        distance: distance,
        phone: barter.phone
            ? {
                id: barter.phone.id,
                number: barter.phone.number
            }
            : null
    };
};

const createBarter = async (userId, requestBody, files, reqObject) => {
    if (!files || !Array.isArray(files) || files.length === 0)
        throw new ResponseError(400, "file.no_file_uploaded");
    // if (files.length > 5)
    //     throw new ResponseError(400, "file.too_many_files");

    const data = validate(createBarterValidation, requestBody, reqObject);

    // Ownership & validation
    await addressIdOwnershipValidate(userId, data.address_id);
    await phoneIdOwnershipValidate(userId, data.phone_id);
    await isCategoryIdValid(data.category_id);

    // Save barter
    const barter = await prismaClient.barter.create({
        data: {
            user_id: userId,
            item_name: data.item_name,
            description: data.description,
            category_id: data.category_id,
            address_id: data.address_id,
            phone_id: data.phone_id,
        },
        include: { category: true }
    });

    // Save all images
    const imagePaths = [];
    for (const file of files) {
        const imagePath = `/assets/barters/postings/${file.filename}`;
        await prismaClient.barterImage.create({
            data: {
                barter_id: barter.id,
                // image_path: file.path.replace(/\\/g, "/"),
                image_path: imagePath,
                image_name: file.originalname,
                image_size: file.size
            }
        });
        imagePaths.push(getPictureUrl(reqObject, imagePath));
    }

    // Create Barter Status
    const barterStatus = await prismaClient.barterStatusHistory.create({
        data: {
            barter_id: barter.id,
            status: "waiting_for_request",
            status_detail: "barter.posting.waiting_for_request_detail",
            // updated_by: userId
        }
    });

    const host = getHost(reqObject);
    const protocol = getProtocol(reqObject);

    await createNotification({
        userId,
        type: "barter",
        entityId: barter.id,
        title: "Barter - Waiting for Request",
        messageKey: "notification.barter_waiting_for_request_message",
        messageData: { item_name: barter.item_name },
        // message: `${donation.item_name} has been submitted for donation`,
        // message: req.__('notification.donation_submitted_message', { item_name: donation.item_name }),
        redirectTo: `${protocol}://${host}/api/users/current/barters/${barter.id}`
    });


    return {
        id: barter.id,
        item_name: barter.item_name,
        description: barter.description,
        category: {
            id: barter.category.id,
            name: barter.category.name
        },
        address_id: barter.address_id,
        phone_id: barter.phone_id,
        images: imagePaths,
        status: barterStatus.status
    };
};

const getBarterHistory = async (userId, search, category, userItemStatus, otherItemStatus, ownership, userItemPage, userItemSize, otherItemPage, otherItemSize, reqObject) => {
    // Prepare result
    const data = { my_items: [], other_items: [] };
    const meta = { my_items: {}, other_items: {} };

    // Current user items
    if (ownership.includes("my_items")) {
        const whereBarterFilter = { user_id: userId };

        if (category && category.length > 0) {
            whereBarterFilter.category = { name: { in: category } };
        }
        if (search) {
            whereBarterFilter.OR = [
                { item_name: { contains: search } },
                { description: { contains: search } },
                // { category: { name: { contains: search} } }
            ];
        }

        const myBarters = await prismaClient.barter.findMany({
            where: whereBarterFilter,
            include: {
                images: true,
                category: true,
                barterStatusHistories: {
                    orderBy: { created_at: "desc" },
                    take: 1 //take last status
                }
            },
            // take: userItemSize,
            // skip: (userItemPage - 1) * userItemSize
        });

        // Filter status
        let filteredMyBarters = myBarters;
        if (userItemStatus && userItemStatus.length > 0) {
            filteredMyBarters = myBarters.filter(myBarter =>
                myBarter.barterStatusHistories.length > 0 &&
                userItemStatus.includes(myBarter.barterStatusHistories[0].status)
            );
        }

        // Pagination
        const userItemTotal = filteredMyBarters.length;
        const pagedMyBarters = filteredMyBarters.slice(
            (userItemPage - 1) * userItemSize,
            userItemPage * userItemSize
        );

        data.my_items = pagedMyBarters.map(barter => ({
            id: barter.id,
            item_name: barter.item_name,
            description: barter.description,
            images: barter.images.map(img => {
                if (!img.image_path.startsWith("http") && !img.image_path.startsWith("https")) {
                    return getPictureUrl(reqObject, img.image_path);
                }
                return img.image_path;
            }),
            category: barter.category
                ? { id: barter.category.id, name: barter.category.name }
                : null,
            status: barter.barterStatusHistories[0]
                ? {
                    id: barter.barterStatusHistories[0].id,
                    status: snakeToTitleCase(barter.barterStatusHistories[0].status),
                    updated_at: barter.barterStatusHistories[0].updated_at,
                }
                : null,
        }));

        meta.my_items = {
            total: userItemTotal,
            page: userItemPage,
            size: userItemSize,
            totalPages: Math.ceil(userItemTotal / userItemSize)
        };
    }

    // User request (riwayat request to barter milik current user)
    if (ownership.includes("other_items")) {
        // Ambil semua barterApplication milik current user
        const whereBarterApp = { user_id: userId };
        if (category && category.length > 0 && !category.includes("all")) {
            whereBarterApp.category = { name: { in: category } };
        }
        if (search) {
            whereBarterApp.OR = [
                { item_name: { contains: search } },
                { description: { contains: search } }
            ];
        }

        const barterApps = await prismaClient.barterApplication.findMany({
            where: whereBarterApp,
            include: {
                barter: {
                    include: {
                        user: true,
                        address: true,
                        category: true,
                        images: true
                    }
                },
                barterApplicationStatusHistories: {
                    orderBy: { created_at: "desc" },
                    take: 1
                }
            }
        });

        // Filter status
        let filteredApps = barterApps;
        if (otherItemStatus && otherItemStatus.length > 0) {
            filteredApps = barterApps.filter(app =>
                app.barterApplicationStatusHistories.length > 0 &&
                otherItemStatus.includes(app.barterApplicationStatusHistories[0].status)
            );
        }

        // Pagination
        const totalOtherItems = filteredApps.length;
        const pagedOtherItems = filteredApps.slice(
            (otherItemPage - 1) * otherItemSize,
            otherItemPage * otherItemSize
        );

        // Get user addresses for distance calculation
        const userAddresses = await prismaClient.address.findMany({ where: { user_id: userId } });
        if (!userAddresses.length) throw new ResponseError(404, "user.no_address");

        data.other_items = pagedOtherItems.map(app => {
            // Distance: min dari semua address user ke address postingan barter
            let distance = null;
            if (userAddresses.length && app.barter.address) {
                const distances = userAddresses.map(addr =>
                    calculateDistance(
                        { latitude: addr.latitude, longitude: addr.longitude },
                        { latitude: app.barter.address.latitude, longitude: app.barter.address.longitude }
                    )
                );
                distance = Math.min(...distances);
            }

            return {
                id: app.id,
                item_name: app.barter.item_name,
                description: app.barter.description,
                images: app.barter.images.map(img =>
                    (!img.image_path.startsWith("http") && !img.image_path.startsWith("https"))
                        ? getPictureUrl(reqObject, img.image_path)
                        : img.image_path
                ),
                category: app.barter.category
                    ? { id: app.barter.category.id, name: app.barter.category.name }
                    : null,
                status: app.barterApplicationStatusHistories[0]
                    ? {
                        id: app.barterApplicationStatusHistories[0].id,
                        status: snakeToTitleCase(app.barterApplicationStatusHistories[0].status),
                        updated_at: app.barterApplicationStatusHistories[0].updated_at
                    }
                    : null,
                user: app.barter.user
                    ? {
                        id: app.barter.user.id,
                        profile_picture: (!app.barter.user.profile_picture?.startsWith("http") && !app.barter.user.profile_picture?.startsWith("https"))
                            ? getPictureUrl(reqObject, app.barter.user.profile_picture)
                            : app.barter.user.profile_picture,
                        username: app.barter.user.username,
                        fullname: app.barter.user.fullname
                    }
                    : null,
                address: app.barter.address
                    ? {
                        id: app.barter.address.id,
                        address: app.barter.address.address,
                        latitude: app.barter.address.latitude,
                        longitude: app.barter.address.longitude
                    }
                    : null,
                distance: distance
            };
        });

        meta.other_items = {
            total: totalOtherItems,
            page: otherItemPage,
            size: otherItemSize,
            totalPages: Math.ceil(totalOtherItems / otherItemSize)
        };
    }

    return {
        meta: meta,
        data: data
    }
}

const getMyBarterDetail = async (userId, barterId, reqObject) => {
    // Ambil barter milik user login
    const barter = await prismaClient.barter.findUnique({
        where: {
            id: barterId,
            user_id: userId
        },
        include: {
            images: true,
            category: true,
            address: true,
            barterStatusHistories: {
                orderBy: { created_at: "asc" } // urutkan status dari awal ke akhir
            }
        }
    });
    if (!barter) throw new ResponseError(404, "barter.not_found");

    // Ambil semua aplikasi barter (barterApplication) yang masuk ke barter ini
    const barterApplications = await prismaClient.barterApplication.findMany({
        where: { barter_id: barterId },
        include: {
            images: true,
            category: true,
            barterApplicationStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1
            },
            user: true,
            address: true
        }
    });

    // Ambil address user login untuk hitung distance
    const userAddresses = await prismaClient.address.findMany({ where: { user_id: userId } });

    // Mapping incoming_request
    const incoming_request = barterApplications.map(app => {
        // Hitung distance (min dari semua address user ke address barter application)
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
            item_name: app.item_name,
            description: app.description,
            images: app.images.map(img =>
                (!img.image_path.startsWith("http") && !img.image_path.startsWith("https"))
                    ? getPictureUrl(reqObject, img.image_path)
                    : img.image_path
            ),
            category: app.category
                ? { id: app.category.id, name: app.category.name }
                : null,
            status: app.barterApplicationStatusHistories[0]
                ? {
                    id: app.barterApplicationStatusHistories[0].id,
                    status: snakeToTitleCase(app.barterApplicationStatusHistories[0].status),
                    updated_at: app.barterApplicationStatusHistories[0].updated_at
                }
                : null,
            user: app.user
                ? {
                    id: app.user.id,
                    profile_picture: (!app.user.profile_picture?.startsWith("http") && !app.user.profile_picture?.startsWith("https"))
                        ? getPictureUrl(reqObject, app.user.profile_picture)
                        : app.user.profile_picture,
                    username: app.user.username,
                    fullname: app.user.fullname
                }
                : null,
            address: app.address
                ? {
                    id: app.address.id,
                    name: app.address.address_name,
                    address: app.address.address,
                    latitude: app.address.latitude,
                    longitude: app.address.longitude
                }
                : null,
            distance: distance
        };
    });

    // Mapping status_histories
    const status_histories = barter.barterStatusHistories.map(status => ({
        id: status.id,
        status: snakeToTitleCase(status.status),
        status_detail: reqObject.__(status.status_detail),
        updated_at: status.updated_at
    }));

    // Mapping response
    return {
        id: barter.id,
        item_name: barter.item_name,
        description: barter.description,
        category: barter.category
            ? { id: barter.category.id, name: barter.category.name }
            : null,
        status: barter.barterStatusHistories.length > 0
            ? snakeToTitleCase(barter.barterStatusHistories[barter.barterStatusHistories.length - 1].status)
            : null,
        address: barter.address
            ? {
                id: barter.address.id,
                name: barter.address.address_name,
                address: barter.address.address,
                latitude: barter.address.latitude,
                longitude: barter.address.longitude
            }
            : null,
        images: barter.images.map(img =>
            (!img.image_path.startsWith("http") && !img.image_path.startsWith("https"))
                ? getPictureUrl(reqObject, img.image_path)
                : img.image_path
        ),
        status_histories: status_histories,
        incoming_request: incoming_request
    };
};

const getMyBarterIncomingRequestDetail = async (userId, barterId, requestId, reqObject) => {
    // Pastikan barterId milik user login
    const barter = await prismaClient.barter.findUnique({
        where: { id: barterId, user_id: userId },
        include: {
            images: true,
            category: true,
            barterStatusHistories: { orderBy: { created_at: "asc" } }
        }
    });
    if (!barter) throw new ResponseError(404, "barter.not_found");

    // Ambil barterApplication (request) spesifik
    const barterApp = await prismaClient.barterApplication.findUnique({
        where: { id: requestId },
        include: {
            images: true,
            category: true,
            barterApplicationStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1
            },
            user: true,
            address: true,
            phone: true
        }
    });
    if (!barterApp || barterApp.barter_id !== barterId)
        throw new ResponseError(404, "barter_application.not_found");

    // Ambil address user login untuk distance
    const userAddresses = await prismaClient.address.findMany({ where: { user_id: userId } });
    let distance = null;
    if (userAddresses.length && barterApp.address) {
        const distances = userAddresses.map(addr =>
            calculateDistance(
                { latitude: addr.latitude, longitude: addr.longitude },
                { latitude: barterApp.address.latitude, longitude: barterApp.address.longitude }
            )
        );
        distance = Math.min(...distances);
    }

    // Mapping barter_with (barter milik user login)
    const barter_with = {
        id: barter.id,
        item_name: barter.item_name,
        description: barter.description,
        images: barter.images.map(img =>
            (!img.image_path.startsWith("http") && !img.image_path.startsWith("https"))
                ? getPictureUrl(reqObject, img.image_path)
                : img.image_path
        ),
        category: {
            id: barter.category.id,
            name: barter.category.name
        },
        status: barter.barterStatusHistories.length > 0
            ? snakeToTitleCase(barter.barterStatusHistories[barter.barterStatusHistories.length - 1].status)
            : null,
        status_histories: barter.barterStatusHistories.map(status => ({
            id: status.id,
            status: snakeToTitleCase(status.status),
            status_detail: reqObject.__(status.status_detail),
            updated_at: status.updated_at
        }))
    };

    // Mapping response
    return {
        id: barterApp.id,
        item_name: barterApp.item_name,
        description: barterApp.description,
        images: barterApp.images.map(img =>
            (!img.image_path.startsWith("http") && !img.image_path.startsWith("https"))
                ? getPictureUrl(reqObject, img.image_path)
                : img.image_path
        ),
        category: barterApp.category
            ? { id: barterApp.category.id, name: barterApp.category.name }
            : null,
        status: barterApp.barterApplicationStatusHistories[0]
            ? {
                id: barterApp.barterApplicationStatusHistories[0].id,
                status: snakeToTitleCase(barterApp.barterApplicationStatusHistories[0].status),
                updated_at: barterApp.barterApplicationStatusHistories[0].updated_at
            }
            : null,
        user: barterApp.user
            ? {
                id: barterApp.user.id,
                profile_picture: (!barterApp.user.profile_picture?.startsWith("http") && !barterApp.user.profile_picture?.startsWith("https"))
                    ? getPictureUrl(reqObject, barterApp.user.profile_picture)
                    : barterApp.user.profile_picture,
                username: barterApp.user.username,
                fullname: barterApp.user.fullname
            }
            : null,
        address: barterApp.address
            ? {
                id: barterApp.address.id,
                address: barterApp.address.address,
                latitude: barterApp.address.latitude,
                longitude: barterApp.address.longitude
            }
            : null,
        phone: barterApp.phone.number,
        distance: distance,
        barter_with: barter_with
    };
};

const processIncomingRequest = async (userId, barterId, requestId, action, decline_reason, reqObject) => {
    // Validasi barterId milik user login
    const barter = await prismaClient.barter.findUnique({
        where: { id: barterId, user_id: userId },
        include: {
            barterStatusHistories: true,
        }
    });
    if (!barter) throw new ResponseError(404, "barter.not_found");

    // Validasi requestId adalah barterApplication ke barterId tsb
    const barterApp = await prismaClient.barterApplication.findUnique({
        where: { id: requestId },
        include: {
            barterApplicationStatusHistories: true
        }
    });
    if (!barterApp || barterApp.barter_id !== barterId)
        throw new ResponseError(404, "barter_application.not_found");

    validate(processBarterRequestValidation, { action, decline_reason }, reqObject);

    if (barter.barterStatusHistories[barter.barterStatusHistories.length - 1].status !== "waiting_for_confirmation") throw new ResponseError(400, "barter.cannot_confirmed");
    if (barterApp.barterApplicationStatusHistories[barterApp.barterApplicationStatusHistories.length - 1].status !== "request_submitted") throw new ResponseError(400, "barter_application.cannot_confirmed");

    if (action === "accept") {
        // 1. Update barter_application_status_histories requestId jadi confirmed
        await prismaClient.barterApplicationStatusHistory.create({
            data: {
                barter_application_id: requestId,
                status: "confirmed",
                status_detail: "barter_application.request.confirmed_detail"
            }
        });

        // Update status pada barter_status_histories menjadi confirmed juga
        await prismaClient.barterStatusHistory.create({
            data: {
                barter_id: barterId,
                status: "confirmed",
                status_detail: "barter.posting.confirmed_detail"
            }
        });

        // 2. Update barter_application requestId (jaga2 jika ada field decline_reason)
        await prismaClient.barterApplication.update({
            where: { id: requestId },
            data: { decline_reason: null }
        });
        // 3. Semua barterApplication lain pada barterId, update status jadi failed
        const otherApps = await prismaClient.barterApplication.findMany({
            where: {
                barter_id: barterId,
                id: { not: requestId }
            },
            include: {
                barterApplicationStatusHistories: {
                    orderBy: { created_at: "desc" },
                    take: 1
                }
            }
        });
        for (const app of otherApps) {
            const lastStatus = app.barterApplicationStatusHistories[0];
            if (lastStatus && lastStatus.status === "failed") continue;

            await prismaClient.barterApplicationStatusHistory.create({
                data: {
                    barter_application_id: app.id,
                    status: "failed",
                    status_detail: "barter_application.request.failed_auto_detail"
                }
            });
            await prismaClient.barterApplication.update({
                where: { id: app.id },
                data: { decline_reason: "barter_application.request.failed_auto_detail" }
            });
        }
    } else if (action === "decline") {
        // 1. Update barterApplicationStatusHistories requestId jadi failed
        await prismaClient.barterApplicationStatusHistory.create({
            data: {
                barter_application_id: requestId,
                status: "failed",
                status_detail: decline_reason
            }
        });
        // 2. Update barter_application requestId (decline_reason)
        await prismaClient.barterApplication.update({
            where: { id: requestId },
            data: { decline_reason }
        });
    }
};

const markBarterAsCompleted = async (userId, barterId, reqObject) => {
    // 1. Validasi barterId milik user login
    const barter = await prismaClient.barter.findUnique({
        where: { id: barterId, user_id: userId },
        include: {
            barterStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1 //take last status
            }
        }
    });
    if (!barter) throw new ResponseError(404, "barter.not_found");

    // 2. Pastikan status terakhir barter adalah confirmed
    const lastStatus = barter.barterStatusHistories[0];
    if (!lastStatus || lastStatus.status !== "confirmed")
        throw new ResponseError(400, "barter.cannot_mark_completed");

    const confirmedApp = await prismaClient.barterApplication.findFirst({
        where: {
            barter_id: barterId,
            barterApplicationStatusHistories: {
                some: { status: "confirmed" }
            }
        },
        include: {
            barterApplicationStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1,
            }
        }
    });
    if (!confirmedApp || confirmedApp.barterApplicationStatusHistories[0].status === 0) throw new ResponseError(400, "barter.no_confirmed_application");
    if (!confirmedApp || confirmedApp.barterApplicationStatusHistories[0].status !== "confirmed") throw new ResponseError(400, "barter_application.cannot_mark_completed");
    // 3. Update barter_status_histories barterId jadi completed
    await prismaClient.barterStatusHistory.create({
        data: {
            barter_id: barterId,
            status: "completed",
            status_detail: "barter.posting.completed_detail"
        }
    });

    // 4. Update barter_application_status_histories requestId jadi completed
    await prismaClient.barterApplicationStatusHistory.create({
        data: {
            barter_application_id: confirmedApp.id,
            status: "completed",
            status_detail: "barter_application.request.completed_detail"
        }
    });

    const host = getHost(reqObject);
    const protocol = getProtocol(reqObject);

    await createNotification({
        userId: barter.user_id,
        type: "barter",
        entityId: barter.id,
        title: "Barter - Completed",
        messageKey: "notification.barter_completed_message",
        redirectTo: `${protocol}://${host}/api/users/current/barters/${barter.id}`
    });
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
}