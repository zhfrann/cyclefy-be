import { validate } from "../validations/validation.js";
import { createBarterApplicationValidation } from "../validations/barterApplicationValidation.js";
import { addressIdOwnershipValidate, phoneIdOwnershipValidate, isCategoryIdValid } from "../helpers/userHelper.js";
import { prismaClient } from "../application/database.js";
import { getPictureUrl } from "../helpers/fileHelper.js";
import { ResponseError } from "../errors/responseError.js";
import { snakeToTitleCase } from "../helpers/statusHelper.js";
import { calculateDistance } from "../helpers/geoHelper.js";
import { logger } from "../application/logging.js";
import fs from "fs/promises";
import { getHost, getProtocol } from "../helpers/httpHelper.js";
import { createNotification } from "./notificationService.js";

const createBarterApplication = async (userId, barterId, requestBody, files, reqObject) => {
    // Validate barterId (must be other users' post)
    const barter = await prismaClient.barter.findUnique({
        where: { id: barterId },
        include: {
            barterStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1  //take last status
            }
        }
    });
    if (!barter) throw new ResponseError(404, "barter.not_found");
    if (barter.user_id === userId) throw new ResponseError(403, 'barter_application.cannot_request_own_post');
    if (barter.barterStatusHistories[0].status !== "waiting_for_request" &&
        barter.barterStatusHistories[0].status !== "waiting_for_confirmation"
    ) throw new ResponseError(403, "barter.status_not_available");

    let applicationData, imagePaths = [], imagesToInsert = [];

    // First option: Use existing item
    if (requestBody.use_existing_barter_id) {
        const userBarterId = Number(requestBody.use_existing_barter_id);
        if (!Number.isInteger(userBarterId) || Number.isNaN(userBarterId)) throw new ResponseError(404, "barter_application.user_barter_id_invalid");
        // Validate ownership
        const userBarter = await prismaClient.barter.findUnique({
            where: { id: userBarterId, user_id: userId },
            include: {
                images: true,
                barterStatusHistories: {
                    orderBy: { created_at: "desc" },
                    take: 1  //take last status
                }
            }
        });
        if (!userBarter) throw new ResponseError(404, "barter_application.user_barter_not_found");
        // if (userBarter.barterStatusHistories[0].status !== "waiting_for_confirmation" &&
        //     userBarter.barterStatusHistories[0].status !== "waiting_for_request"
        // ) throw new ResponseError(400, "barter.exists_item_status_not_available");

        // Check duplicate
        const duplicate = await prismaClient.barterApplication.findFirst({
            where: {
                barter_id: barterId,
                user_id: userId,
                item_name: userBarter.item_name
            }
        });
        if (duplicate) throw new ResponseError(409, "barter_application.duplicate_existing_item");

        applicationData = {
            barter_id: barterId,
            user_id: userId,
            item_name: userBarter.item_name,
            description: userBarter.description,
            category_id: userBarter.category_id,
            address_id: userBarter.address_id,
            phone_id: userBarter.phone_id,
            // decline_reason: ""
        };

        // Siapkan data gambar untuk insert setelah barterApplication dibuat
        imagesToInsert = userBarter.images.map(image => ({
            image_path: image.image_path,
            image_name: image.image_name,
            image_size: image.image_size
        }));
        imagePaths = imagesToInsert.map(img => getPictureUrl(reqObject, img.image_path));

        if (files && Array.isArray(files)) {
            for (const file of files) {
                if (file && file.path) {
                    try { await fs.unlink(file.path); } catch (e) { logger.error("[BarterApplicationService:72]Failed to delete uploaded barter application image: ", e); }
                }
            }
        }
    } else {
        const data = validate(createBarterApplicationValidation, requestBody, reqObject);
        if (!files || !Array.isArray(files) || files.length === 0)
            throw new ResponseError(400, "file.no_file_uploaded", {
                images: null
            });
        // if (files.length > 5)
        //     throw new ResponseError(400, "file.too_many_files");

        // Second option: manual
        await addressIdOwnershipValidate(userId, data.address_id);
        await phoneIdOwnershipValidate(userId, data.phone_id);
        await isCategoryIdValid(data.category_id);

        applicationData = {
            barter_id: barterId,
            user_id: userId,
            item_name: data.item_name,
            description: data.description,
            category_id: data.category_id,
            address_id: data.address_id,
            phone_id: data.phone_id,
            // decline_reason: ""
        };

        // Siapkan data gambar upload untuk insert setelah barterApplication dibuat
        imagesToInsert = (files || []).map(file => ({
            image_path: `/assets/barters/applications/${file.filename}`,
            image_name: file.originalname,
            image_size: file.size
        }));
        imagePaths = imagesToInsert.map(img => getPictureUrl(reqObject, img.image_path));
    }

    // Create Barter Application
    const barterApplication = await prismaClient.barterApplication.create({
        data: applicationData
    });

    // Insert semua gambar dengan barter_application_id yang sudah pasti
    if (imagesToInsert.length > 0) {
        await prismaClient.barterApplicationImage.createMany({
            data: imagesToInsert.map(img => ({
                ...img,
                barter_application_id: barterApplication.id
            }))
        });
    }

    // Create barter application status
    await prismaClient.barterApplicationStatusHistory.create({
        data: {
            barter_application_id: barterApplication.id,
            status: "request_submitted",
            status_detail: "barter_application.request.request_submitted_detail",
            // updated_by: userId
        }
    });

    // Update barter status
    const latestBarterStatus = await prismaClient.barterStatusHistory.findFirst({
        where: { barter_id: barterId },
        orderBy: { created_at: "desc" }
    });
    if (latestBarterStatus && latestBarterStatus.status === "waiting_for_request") {
        await prismaClient.barterStatusHistory.create({
            data: {
                barter_id: barterId,
                status: "waiting_for_confirmation",
                status_detail: "barter.posting.waiting_for_confirmation_detail",
                // updated_by: userId
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
        userId: barter.user_id,
        type: "barter",
        entityId: barter.id,
        title: "Barter - Waiting for Confirmation",
        messageKey: "notification.barter_waiting_for_confirmation_message",
        messageData: { applicant_name: applicant.fullname, applicant_item: applicationData.item_name, item_name: barter.item_name },
        redirectTo: `${protocol}://${host}/api/users/current/barters/${barter.id}`
    });

    return {
        id: barterApplication.id,
        barter_id: barterId,
        item_name: barterApplication.item_name,
        description: barterApplication.description,
        category_id: barterApplication.category_id,
        address_id: barterApplication.address_id,
        phone_id: barterApplication.phone_id,
        images: imagePaths,
        status: snakeToTitleCase("request_submitted")
    };
};

const getMyRequestDetail = async (userId, requestId, reqObject) => {
    // 1. Ambil barterApplication milik current user
    const barterApp = await prismaClient.barterApplication.findUnique({
        where: { id: requestId },
        include: {
            images: true,
            category: true,
            barterApplicationStatusHistories: { orderBy: { created_at: "asc" } },
            barter: {
                include: {
                    images: true,
                    category: true,
                    user: true,
                    address: true
                }
            },
            address: true
        }
    });
    if (!barterApp) throw new ResponseError(404, "barter_application.not_found");
    if (barterApp.user_id !== userId) throw new ResponseError(403, "barter_application.forbidden");

    // 2. Hitung distance dari alamat user ke address postingan barter
    const userAddresses = await prismaClient.address.findMany({ where: { user_id: userId } });
    let distance = null;
    if (userAddresses.length && barterApp.barter && barterApp.barter.address) {
        const distances = userAddresses.map(addr =>
            calculateDistance(
                { latitude: addr.latitude, longitude: addr.longitude },
                { latitude: barterApp.barter.address.latitude, longitude: barterApp.barter.address.longitude }
            )
        );
        distance = Math.min(...distances);
    }

    // 3. Mapping barter_with (item yang current user ajukan)
    const barter_with = {
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
        status: barterApp.barterApplicationStatusHistories.length > 0
            ? {
                id: barterApp.barterApplicationStatusHistories[barterApp.barterApplicationStatusHistories.length - 1].id,
                status: snakeToTitleCase(barterApp.barterApplicationStatusHistories[barterApp.barterApplicationStatusHistories.length - 1].status),
                updated_at: barterApp.barterApplicationStatusHistories[barterApp.barterApplicationStatusHistories.length - 1].updated_at
            }
            : null,
        address: {
            id: barterApp.address.id,
            name: barterApp.address.address_name,
            address: barterApp.address.address,
            latitude: barterApp.address.latitude,
            longitude: barterApp.address.longitude
        }
    };

    // 4. Mapping status_histories dari barterApplication
    const status_histories = barterApp.barterApplicationStatusHistories.map(status => ({
        id: status.id,
        status: snakeToTitleCase(status.status),
        status_detail: reqObject.__(status.status_detail),
        updated_at: status.updated_at
    }));

    // 5. Mapping response utama (data postingan barter user lain)
    return {
        id: barterApp.barter.id,
        item_name: barterApp.barter.item_name,
        description: barterApp.barter.description,
        images: barterApp.barter.images.map(img =>
            (!img.image_path.startsWith("http") && !img.image_path.startsWith("https"))
                ? getPictureUrl(reqObject, img.image_path)
                : img.image_path
        ),
        category: barterApp.barter.category
            ? { id: barterApp.barter.category.id, name: barterApp.barter.category.name }
            : null,
        status: barterApp.barterApplicationStatusHistories.length > 0
            ? snakeToTitleCase(barterApp.barterApplicationStatusHistories[barterApp.barterApplicationStatusHistories.length - 1].status)
            : null,
        status_histories: status_histories,
        address: barterApp.barter.address
            ? {
                id: barterApp.barter.address.id,
                name: barterApp.barter.address.address_name,
                address: barterApp.barter.address.address,
                latitude: barterApp.barter.address.latitude,
                longitude: barterApp.barter.address.longitude
            }
            : null,
        distance: distance,
        user: barterApp.barter.user
            ? {
                id: barterApp.barter.user.id,
                profile_picture: (!barterApp.barter.user.profile_picture?.startsWith("http") && !barterApp.barter.user.profile_picture?.startsWith("https"))
                    ? getPictureUrl(reqObject, barterApp.barter.user.profile_picture)
                    : barterApp.barter.user.profile_picture,
                username: barterApp.barter.user.username,
                fullname: barterApp.barter.user.fullname
            }
            : null,
        barter_with: barter_with
    };
};

export default { createBarterApplication, getMyRequestDetail };