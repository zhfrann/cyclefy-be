import { prismaClient } from "../application/database.js";
import { ResponseError } from "../errors/responseError.js";
import { getPictureUrl } from "../helpers/fileHelper.js";
import { calculateDistance } from "../helpers/geoHelper.js";
import { getHost, getProtocol } from "../helpers/httpHelper.js";
import { snakeToTitleCase } from "../helpers/statusHelper.js";
import { addressIdOwnershipValidate, isCategoryIdValid, phoneIdOwnershipValidate } from "../helpers/userHelper.js";
import { createRecycleValidation } from "../validations/recycleValidation.js";
import { validate } from "../validations/validation.js";
import { createNotification } from "./notificationService.js";

const getRecycleLocations = async (userId, search, category, maxDistance, location, sortBy, size, page, reqObject) => {
    // 1. Ambil semua address user login
    const userAddresses = await prismaClient.address.findMany({ where: { user_id: userId } });
    if (!userAddresses.length) throw new ResponseError(404, "user.no_address");

    // 2. Build where clause
    const where = {};
    if (search) {
        where.location_name = { contains: search };
    }
    if (!maxDistance && location) {
        where.address = { contains: location };
    }

    // 3. Query all recycle locations beserta relasi
    const locations = await prismaClient.recycleLocation.findMany({
        where,
        include: {
            recycleLocationCategories: { include: { category: true } },
            RecycleLocationImage: true
        }
    });

    // 4. Filter by category (jika ada)
    let filtered = locations;
    if (category && category.length > 0) {
        const categoryArr = category.map(c => c.trim().toLowerCase());
        filtered = filtered.filter(loc =>
            loc.recycleLocationCategories.some(cat =>
                categoryArr.includes(cat.category.name.toLowerCase())
            )
        );
    }

    // 5. Hitung distance terdekat dari semua address user login
    const mapped = filtered.map(loc => {
        let minDistance = null;
        if (userAddresses.length) {
            const distances = userAddresses.map(addr =>
                calculateDistance(
                    { latitude: addr.latitude, longitude: addr.longitude },
                    { latitude: loc.latitude, longitude: loc.longitude }
                )
            );
            minDistance = Math.min(...distances);
        }
        return {
            id: loc.id,
            location_name: loc.location_name,
            address: loc.address,
            latitude: loc.latitude,
            longitude: loc.longitude,
            distance: minDistance,
            categories: loc.recycleLocationCategories.map(cat => ({
                id: cat.category.id,
                name: cat.category.name
            })),
            images: loc.RecycleLocationImage.map(img => img.image_path)
        };
    });

    // 6. Filter by maxDistance (jika ada)
    let result = mapped;
    if (maxDistance && typeof maxDistance === "number" && !isNaN(maxDistance)) {
        result = result.filter(loc => loc.distance !== null && loc.distance <= maxDistance);
    }

    // 7. Sorting
    if (sortBy === "nearest") {
        result = result.sort((a, b) => (a.distance ?? 99999) - (b.distance ?? 99999));
    } // default: relevance (urutan dari DB)

    const total = result.length;
    const totalPages = Math.ceil(total / size);
    const paged = result.slice((page - 1) * size, page * size);

    const meta = {
        total: total,
        page: page,
        size: size,
        totalPages: totalPages
    }

    return { meta: meta, data: paged };
};

const getRecycleLocationDetail = async (userId, recycleLocationId, reqObject) => {
    // 1. Ambil semua address user login
    const userAddresses = await prismaClient.address.findMany({ where: { user_id: userId } });
    if (!userAddresses.length) throw new ResponseError(404, "user.no_address");

    // 2. Ambil recycle location beserta relasi
    const loc = await prismaClient.recycleLocation.findUnique({
        where: { id: recycleLocationId },
        include: {
            recycleLocationCategories: { include: { category: true } },
            RecycleLocationImage: true
        }
    });
    if (!loc) throw new ResponseError(404, "recycle_location.not_found");

    // 3. Hitung distance terdekat dari semua address user login
    let minDistance = null;
    if (userAddresses.length) {
        const distances = userAddresses.map(addr =>
            calculateDistance(
                { latitude: addr.latitude, longitude: addr.longitude },
                { latitude: loc.latitude, longitude: loc.longitude }
            )
        );
        minDistance = Math.min(...distances);
    }

    // 4. Mapping response
    return {
        id: loc.id,
        location_name: loc.location_name,
        address: loc.address,
        latitude: loc.latitude,
        longitude: loc.longitude,
        phone: loc.phone,
        description: loc.description,
        distance: minDistance,
        categories: loc.recycleLocationCategories.map(cat => ({
            id: cat.category.id,
            name: cat.category.name
        })),
        images: loc.RecycleLocationImage.map(img => img.image_path)
    };
};

const createRecycle = async (userId, requestBody, files, reqObject) => {
    if (!files || !Array.isArray(files) || files.length === 0)
        throw new ResponseError(400, "file.no_file_uploaded");
    // if (files.length > 5)
    //     throw new ResponseError(400, "file.too_many_files");

    const data = validate(createRecycleValidation, requestBody, reqObject);

    // Make sure the address and phone is owned by userId (ownership checking)
    await addressIdOwnershipValidate(userId, data.address_id);
    await phoneIdOwnershipValidate(userId, data.phone_id);
    await isCategoryIdValid(data.category_id);

    const recycleLocation = await prismaClient.recycleLocation.findUnique({
        where: { id: data.recycle_location_id }
    });
    if (!recycleLocation) throw new ResponseError(404, "recycle.recycle_location_not_found");

    // Save recycle
    const recycle = await prismaClient.recycle.create({
        data: {
            user_id: userId,
            item_name: data.item_name,
            description: data.description,
            category_id: data.category_id,
            address_id: data.address_id,
            phone_id: data.phone_id,
            recycle_location_id: data.recycle_location_id
        },
        include: {
            category: true,
            recycle_location: true
        }
    });

    // Save all images
    const imagePaths = [];
    for (const file of files) {
        const imagePath = `/assets/recycles/posts/${file.filename}`;
        await prismaClient.recycleImage.create({
            data: {
                recycle_id: recycle.id,
                image_path: imagePath,
                image_name: file.originalname,
                image_size: file.size
            }
        });
        imagePaths.push(getPictureUrl(reqObject, imagePath));
    }

    // Create Donation Status
    const recycleStatus = await prismaClient.recycleStatusHistory.create({
        data: {
            // donation_id: donation.id,
            recycle_id: recycle.id,
            status: "submitted",
            status_detail: "recycle.post.submitted_detail",
            // updated_by: userId
        }
    });

    const host = getHost(reqObject);
    const protocol = getProtocol(reqObject);

    await createNotification({
        userId,
        type: "recycle",
        entityId: recycle.id,
        title: "Recycle - Submitted",
        messageKey: "notification.recycle_submitted_message",
        messageData: { item_name: recycle.item_name },
        redirectTo: `${protocol}://${host}/api/users/current/recycles/${recycle.id}`
    });

    return {
        id: recycle.id,
        item_name: recycle.item_name,
        description: recycle.description,
        category: {
            id: recycle.category.id,
            name: recycle.category.name
        },
        address_id: recycle.address_id,
        phone_id: recycle.phone_id,
        image: imagePaths,
        status: snakeToTitleCase(recycleStatus.status),
        location: {
            id: recycle.recycle_location.id,
            name: recycle.recycle_location.location_name,
            address: recycle.recycle_location.address,
            latitude: recycle.recycle_location.latitude,
            longitude: recycle.recycle_location.longitude,
        }
    };
};

export default {
    getRecycleLocations,
    getRecycleLocationDetail,
    createRecycle
};