import { prismaClient } from "../application/database.js";
import { createDonationValidation } from "../validations/donationValidation.js";
import { validate } from "../validations/validation.js";
import { ResponseError } from "../errors/responseError.js";
import path from "path";
import fs from "fs/promises";
import { addressIdOwnershipValidate, isCategoryIdValid, phoneIdOwnershipValidate } from "../helpers/userHelper.js";
import { getPictureUrl } from "../helpers/fileHelper.js";
import { snakeToTitleCase } from "../helpers/statusHelper.js";
import { createNotification } from "./notificationService.js";
import { getHost, getProtocol } from "../helpers/httpHelper.js";

const createDonation = async (userId, requestBody, files, reqObject) => {
    if (!files || !Array.isArray(files) || files.length === 0)
        throw new ResponseError(400, "file.no_file_uploaded");
    // if (files.length > 5)
    //     throw new ResponseError(400, "file.too_many_files");

    const data = validate(createDonationValidation, requestBody, reqObject);

    // Make sure the address and phone is owned by userId (ownership checking)
    await addressIdOwnershipValidate(userId, data.address_id);
    await phoneIdOwnershipValidate(userId, data.phone_id);
    await isCategoryIdValid(data.category_id);

    // Save donation
    const donation = await prismaClient.donation.create({
        data: {
            user_id: userId,
            item_name: data.item_name,
            description: data.description,
            category_id: data.category_id,
            address_id: data.address_id,
            phone_id: data.phone_id,
        },
        include: {
            category: true
        }
    });

    // Save all images
    const imagePaths = [];
    for (const file of files) {
        const imagePath = `/assets/donations/offers/${file.filename}`;
        await prismaClient.donationImage.create({
            data: {
                donation_id: donation.id,
                image_path: imagePath,
                image_name: file.originalname,
                image_size: file.size
            }
        });
        imagePaths.push(getPictureUrl(reqObject, imagePath));
    }

    // Create Donation Status
    const donationStatus = await prismaClient.donationStatusHistory.create({
        data: {
            donation_id: donation.id,
            status: "submitted",
            status_detail: "donation.submitted_detail",
            updated_by: userId
        }
    });

    const host = getHost(reqObject);
    const protocol = getProtocol(reqObject);

    await createNotification({
        userId,
        type: "donation",
        entityId: donation.id,
        title: "Donation - Submitted",
        messageKey: "notification.donation_submitted_message",
        messageData: { item_name: donation.item_name },
        redirectTo: `${protocol}://${host}/api/users/current/donations/${donation.id}`
    });

    return {
        id: donation.id,
        item_name: donation.item_name,
        description: donation.description,
        category: {
            id: donation.category.id,
            name: donation.category.name
        },
        address_id: donation.address_id,
        phone_id: donation.phone_id,
        image: imagePaths,
        status: snakeToTitleCase(donationStatus.status)
    };
};

const getDonations = async (userId, page, size, search, category, statuses, reqObject) => {
    // Build where clause
    const where = {};

    if (search) {
        where.OR = [
            { item_name: { contains: search } },
            { description: { contains: search } },
            // { category: { name: { contains: search} } }
        ];
    }
    if (category && category.length > 0) {
        where.category = { name: { in: category } };
    }

    // Get data
    const donations = await prismaClient.donation.findMany({
        where: {
            ...where,
            user_id: userId,
        },
        // orderBy: { updated_at: "desc" },
        include: {
            images: true,
            category: true,
            donationStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1 //take last status
            }
        }
    });

    let filteredDonations = donations;
    // filter last status
    if (statuses && statuses.length > 0) {
        filteredDonations = donations.filter(donation =>
            donation.donationStatusHistories.length > 0 &&
            statuses.includes(donation.donationStatusHistories[0].status)
        );
    }

    // Pagination
    const total = filteredDonations.length;
    const pagedDonations = filteredDonations.slice((page - 1) * size, page * size);

    // Mapping response
    const data = pagedDonations.map(donation => ({
        id: donation.id,
        item_name: donation.item_name,
        description: donation.description,
        images: donation.images.map(img => {
            if (!img.image_path.startsWith("http") || !img.image_path.startsWith("https")) {
                return getPictureUrl(reqObject, img.image_path);
            }
            return img.image_path;
        }),
        category: donation.category
            ? { id: donation.category.id, name: donation.category.name }
            : null,
        // status: donation.donationStatusHistories[0]?.status || null,
        status: donation.donationStatusHistories[0]
            ? {
                id: donation.donationStatusHistories[0].id,
                status: snakeToTitleCase(donation.donationStatusHistories[0].status),
                updated_at: donation.donationStatusHistories[0].updated_at
            }
            : null
        // updated_at: donation.updated_at,
        // updated_at: donation.donationStatusHistories[donation.donationStatusHistories.length - 1].updated_at,
    }));

    return {
        meta: {
            total: total,
            page: page,
            size: size,
            totalPages: Math.ceil(total / size),
        },
        data: data
    };
}

const getDonationDetail = async (userId, donationId, reqObject) => {
    const donation = await prismaClient.donation.findUnique({
        where: {
            id: donationId,
            user_id: userId
        },
        include: {
            category: true,
            images: true,
            address: true,
            donationStatusHistories: {
                orderBy: { created_at: "asc" },
                include: {
                    updated: {
                        select: {
                            id: true,
                            fullname: true,
                            username: true,
                        }
                    }
                }
            }
        }
    });

    if (!donation || donation.user_id !== userId) throw new ResponseError(404, "donation.not_found");

    // Mapping response
    return {
        id: donation.id,
        item_name: donation.item_name,
        description: donation.description,
        images: donation.images.map(img => {
            if (!img.image_path.startsWith("http") || !img.image_path.startsWith("https")) {
                return getPictureUrl(reqObject, img.image_path);
            }
            return img.image_path;
        }),
        category: { id: donation.category.id, name: donation.category.name },
        status: snakeToTitleCase(donation.donationStatusHistories[donation.donationStatusHistories.length - 1]?.status) || null,
        address: {
            id: donation.address.id,
            name: donation.address.address_name,
            address: donation.address.address,
            latitue: donation.address.latitude,
            longitude: donation.address.longitude
        },
        status_histories: donation.donationStatusHistories.map(status => ({
            id: status.id,
            status: snakeToTitleCase(status.status),
            status_detail: reqObject.__(status.status_detail),
            // created_at: status.created_at,
            updated_at: status.updated_at,
            // updated_by: status.updated ? {
            //     id: status.updated.id,
            //     fullname: status.updated.fullname,
            //     username: status.updated.username
            // } : null,
        })),
        // updated_at: donation.updated_at,
        // updated_at: donation.donationStatusHistories[donation.donationStatusHistories.length - 1].updated_at,
    }
}

export default { createDonation, getDonations, getDonationDetail };