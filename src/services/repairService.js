import { prismaClient } from "../application/database.js"
import { ResponseError } from "../errors/responseError.js";
import { getPictureUrl } from "../helpers/fileHelper.js";
import { snakeToTitleCase } from "../helpers/statusHelper.js";
import { addressIdOwnershipValidate, isCategoryIdValid, phoneIdOwnershipValidate } from "../helpers/userHelper.js";
import { createRepairValidation } from "../validations/repairValidation.js";
import { validate } from "../validations/validation.js";
import { snap } from "../application/midtrans.js";
import { env } from "../application/env.js";
import axios from "axios";
import { wibToUtc } from "../helpers/dateHelper.js";
import { getHost, getProtocol } from "../helpers/httpHelper.js";
import { createNotification } from "./notificationService.js";

const getRepairPrice = async (categoryId) => {
    const repairPrices = await prismaClient.repairPrice.findUnique({
        where: { category_id: categoryId },
        include: {
            category: true,
        }
    });
    if (!repairPrices) throw new ResponseError(404, "repair.price_not_found");
    if (!repairPrices.minor_repair || !repairPrices.moderate_repair || !repairPrices.major_repair) throw new ResponseError(404, "repair.price_not_found");

    return {
        id: repairPrices.id,
        category: {
            id: repairPrices.category.id,
            name: repairPrices.category.name
        },
        minor_price: repairPrices.minor_repair,
        moderate_price: repairPrices.moderate_repair,
        major_price: repairPrices.major_repair,
    }
};

const createRepair = async (userId, requestBody, files, reqObject) => {
    // 1. Validasi request
    const data = validate(createRepairValidation, requestBody, reqObject);

    // 2. Ownership & validasi
    await addressIdOwnershipValidate(userId, data.address_id);
    await phoneIdOwnershipValidate(userId, data.phone_id);
    await isCategoryIdValid(data.category_id);

    // 3. Validasi file upload
    if (!files || (!files.front_view && !files.close_up_damage))
        throw new ResponseError(400, "file.no_file_uploaded");
    if (!Array.isArray(files.front_view) || files.front_view.length === 0)
        throw new ResponseError(400, "file.front_view_required");
    if (!Array.isArray(files.close_up_damage) || files.close_up_damage.length === 0)
        throw new ResponseError(400, "file.close_up_damage_required");

    // 4. Ambil harga per kg dari repairPrice
    const repairPrice = await prismaClient.repairPrice.findUnique({
        where: { category_id: data.category_id }
    });
    if (!repairPrice) throw new ResponseError(404, "repair.price_not_found");

    let pricePerKg = 0;
    if (data.repair_type === "minor_repair") pricePerKg = repairPrice.minor_repair;
    else if (data.repair_type === "moderate_repair") pricePerKg = repairPrice.moderate_repair;
    else if (data.repair_type === "major_repair") pricePerKg = repairPrice.major_repair;
    else throw new ResponseError(400, "repair.invalid_type");

    const amount = pricePerKg * Number(data.item_weight);

    // 5. Simpan entitas Repair
    const repair = await prismaClient.repair.create({
        data: {
            user_id: userId,
            item_name: data.item_name,
            description: data.description,
            category_id: data.category_id,
            item_weight: Number(data.item_weight),
            repair_type: data.repair_type,
            address_id: data.address_id,
            phone_id: data.phone_id,
            repair_location: data.repair_location,
        },
        include: {
            category: true,
            address: true,
            phone: true,
            user: true
        }
    });

    // 6. Simpan gambar ke RepairImage
    const imagePaths = [];
    const saveImages = async (fileArray, type) => {
        for (const file of fileArray) {
            // Penamaan file sudah diatur di middleware, cukup simpan path dan type
            const image = await prismaClient.repairImage.create({
                data: {
                    repair_id: repair.id,
                    image_path: `/assets/repairs/${file.filename}`,
                    image_name: file.originalname,
                    image_size: file.size,
                    image_type: type
                }
            });
            imagePaths.push(getPictureUrl(reqObject, image.image_path));
        }
    };
    await saveImages(files.front_view, "front_view");
    await saveImages(files.close_up_damage, "close_up_damage");

    // 7. Buat status history
    await prismaClient.repairStatusHistory.create({
        data: {
            repair_id: repair.id,
            status: "request_submitted",
            status_detail: "repair.status.request_submitted_detail",
            // updated_by: userId
        }
    });

    const orderId = `REPAIR-${repair.user.id}-${repair.id}-${Date.now()}`;

    // 8. Buat payment
    const payment = await prismaClient.repairPayment.create({
        data: {
            repair_id: repair.id,
            user_id: userId,
            order_id: orderId,
            amount: amount,
            admin_fee: Math.ceil(amount * 0.05),
            status: "pending"
        },
        include: {
            user: true
        }
    });

    const host = getHost(reqObject);
    const protocol = getProtocol(reqObject);

    await createNotification({
        userId,
        type: "repair",
        entityId: repair.id,
        title: "Repair - Request Submitted",
        messageKey: "notification.repair_request_submitted_message",
        messageData: { item_name: repair.item_name },
        redirectTo: `${protocol}://${host}/api/users/current/repairs/${repair.id}`
    });

    // 9. Mapping response
    return {
        id: repair.id,
        item_name: repair.item_name,
        description: repair.description,
        category: {
            id: repair.category.id,
            name: repair.category.name
        },
        item_weight: repair.item_weight,
        repair_type: repair.repair_type,
        address: {
            id: repair.address.id,
            address: repair.address.address,
        },
        phone: {
            id: repair.phone.id,
            number: repair.phone.number
        },
        repair_location: repair.repair_location,
        images: imagePaths,
        status: snakeToTitleCase("request_submitted"),
        payment: {
            id: payment.id,
            repair_id: payment.repair_id,
            order_id: payment.order_id,
            user: {
                id: payment.user.id,
                // profile_picture: payment.user.profile_picture,
                profile_picture: (!payment.user.profile_picture.startsWith('http') && !payment.user.profile_picture.startsWith('https'))
                    ? getPictureUrl(reqObject, payment.user.profile_picture)
                    : payment.user.profile_picture,
                username: payment.user.username,
                fullname: payment.user.fullname
            },
            amount: payment.amount,
            admin_fee: payment.admin_fee,
            total: (payment.amount + payment.admin_fee),
            status: snakeToTitleCase(payment.status)
        }
    };
};

const getRepairDetail = async (userId, repairId, reqObject) => {
    // 1. Ambil Repair + relasi
    const repair = await prismaClient.repair.findUnique({
        where: { id: repairId },
        include: {
            category: true,
            address: true,
            phone: true,
            user: true,
            images: true,
            repairPayments: {
                include: { user: true },
                orderBy: { created_at: "desc" }, // ambil payment terbaru
                take: 1
            },
            repairStatusHistories: {
                orderBy: { created_at: "desc" },
                take: 1
            }
        }
    });
    if (!repair) throw new ResponseError(404, "repair.not_found");

    // 2. Ownership check (kalau memang harus milik user)
    if (repair.user_id !== userId) {
        throw new ResponseError(403, "repair.forbidden");
    }

    // 3. Mapping images → url
    const imagePaths = repair.images.map(img => {
        if (!img.image_path.startsWith('http') || !img.image_path.startsWith('https')) {
            return getPictureUrl(reqObject, img.image_path)
        }
        return img.image_path
    });

    // 4. Ambil status terakhir
    const latestStatus = repair.repairStatusHistories[0];

    // 5. Ambil payment terbaru
    const payment = repair.repairPayments[0];

    // 6. Bentuk response
    return {
        id: repair.id,
        item_name: repair.item_name,
        description: repair.description,
        category: {
            id: repair.category.id,
            name: repair.category.name
        },
        item_weight: repair.item_weight,
        repair_type: repair.repair_type,
        address: {
            id: repair.address.id,
            address: repair.address.address,
        },
        phone: {
            id: repair.phone.id,
            number: repair.phone.number
        },
        repair_location: repair.repair_location,
        images: imagePaths,
        status: snakeToTitleCase(latestStatus?.status ?? "unknown"),
        payment: payment ? {
            id: payment.id,
            repair_id: payment.repair_id,
            order_id: payment.order_id,
            user: {
                id: payment.user.id,
                profile_picture: (!payment.user.profile_picture.startsWith('http') && !payment.user.profile_picture.startsWith('https'))
                    ? getPictureUrl(reqObject, payment.user.profile_picture)
                    : payment.user.profile_picture,
                username: payment.user.username,
                fullname: payment.user.fullname
            },
            amount: payment.amount,
            admin_fee: payment.admin_fee,
            total: (payment.amount + payment.admin_fee),
            status: snakeToTitleCase(payment.status)
        } : null
    };
};

// const requestRepairPayment = async (userId, repairId, paymentType, options = {}) => {
//     // 1. Ambil data repair & payment
//     const repair = await prismaClient.repair.findUnique({
//         where: { id: repairId },
//         include: { repairPayments: true, user: true, category: true, phone: true, address: true }
//     });
//     if (!repair) throw new ResponseError(404, "repair.not_found");
//     if (repair.user_id !== userId) throw new ResponseError(403, "repair.forbidden");

//     let payment = repair.repairPayments[0];
//     if (!payment) throw new ResponseError(404, "repair.payment_not_found");
//     if (payment.status !== "pending") throw new ResponseError(400, "repair.payment_already_processed");

//     // 2. Generate parameter Midtrans
//     const parameter = {
//         transaction_details: {
//             order_id: payment.order_id,
//             gross_amount: payment.amount + (payment.admin_fee || 0)
//         },
//         customer_details: {
//             first_name: repair.user.fullname,
//             email: repair.user.email,
//             phone: repair.phone.number,
//             billing_address: {
//                 first_name: repair.user.fullname,
//                 email: repair.user.email,
//                 phone: repair.phone.number,
//                 address: repair.address.city,
//                 city: repair.address.state,
//                 postal_code: repair.address.zipcode,
//                 country_code: "IDN"
//             },
//         },
//         item_details: [
//             {
//                 id: repair.id,
//                 name: repair.item_name,
//                 price: payment.amount,
//                 quantity: 1,
//                 category: repair.category.name
//             },
//             {
//                 id: "admin_fee",
//                 name: "Admin Fee",
//                 price: payment.admin_fee || 0,
//                 quantity: 1
//             }
//         ]
//     };

//     // Payment type specific
//     if (paymentType === "bank_transfer") {
//         parameter.payment_type = "bank_transfer";
//         parameter.bank_transfer = { bank: options.bank_code || "bca" };
//     } else if (paymentType === "qris") {
//         parameter.payment_type = "qris";
//     } else if (paymentType === "e_wallet") {
//         parameter.payment_type = options.ewallet_type; // gopay, shopeepay, dll
//     } else {
//         throw new ResponseError(400, "payment.invalid_type");
//     }

//     // 3. Request ke Midtrans
//     const midtransRes = await snap.createTransaction(parameter);

//     // 4. Update payment di DB
//     await prismaClient.repairPayment.update({
//         where: { id: payment.id },
//         data: {
//             payment_type: paymentType,
//             bank_code: options.bank_code,
//             ewallet_type: options.ewallet_type,
//             va_number: midtransRes.va_numbers ? midtransRes.va_numbers[0].va_number : null,
//             qris_url: midtransRes.actions ? midtransRes.actions.find(a => a.name === "generate-qr-code")?.url : null,
//             status: "pending"
//         }
//     });

//     // 5. Kembalikan data untuk frontend
//     return {
//         order_id: payment.order_id,
//         payment_type: paymentType,
//         admin_fee: payment.admin_fee,
//         total_payment: payment.amount + (payment.admin_fee || 0),
//         payment_url: midtransRes.redirect_url || null,
//         va_number: midtransRes.va_numbers ? midtransRes.va_numbers[0].va_number : null,
//         qris_url: midtransRes.actions ? midtransRes.actions.find(a => a.name === "generate-qr-code")?.url : null,
//         status: "pending",
//         midtransRes: midtransRes
//     };
// };

const requestRepairPayment = async (userId, repairId, paymentType, options = {}) => {
    // 1. Ambil data repair & payment
    const repair = await prismaClient.repair.findUnique({
        where: { id: repairId },
        include: { repairPayments: true, user: true, category: true, address: true, phone: true }
    });
    if (!repair) throw new ResponseError(404, "repair.not_found");
    if (repair.user_id !== userId) throw new ResponseError(403, "repair.forbidden");

    let payment = repair.repairPayments[0];
    if (!payment) throw new ResponseError(404, "repair.payment_not_found");
    if (payment.status !== "pending") throw new ResponseError(400, "repair.payment_already_processed");

    // 2. Build charge payload
    const grossAmount = payment.amount + (payment.admin_fee || 0);
    const orderId = payment.order_id;

    const payload = {
        payment_type: paymentType,
        transaction_details: {
            order_id: orderId,
            gross_amount: grossAmount
        },
        customer_details: {
            first_name: repair.user.fullname || repair.user.username,
            email: repair.user.email,
            phone: repair.user.phone?.number,
            billing_address: {
                first_name: repair.user.fullname,
                email: repair.user.email,
                phone: repair.phone.number,
                address: repair.address.city,
                city: repair.address.state,
                postal_code: repair.address.zipcode,
                country_code: "IDN"
            },
        },
        item_details: [
            {
                id: repair.id,
                name: repair.item_name,
                price: payment.amount,
                quantity: 1,
                category: repair.category.name
            },
            {
                id: "admin_fee",
                name: "Admin Fee",
                price: payment.admin_fee || 0,
                quantity: 1
            }
        ],
        custom_expiry: { expiry_duration: 25, unit: 'minute' },
    };

    // Tambahkan payment_type spesifik
    if (paymentType === "bank_transfer") {
        if (!options.bankCode) throw new ResponseError(400, "payment.invalid_type");
        payload.bank_transfer = { bank: options.bankCode };
    } else if (paymentType === "qris") {
        // Tidak perlu tambahan
    } else if (paymentType === "e_wallet") {
        if (!options.ewalletType) throw new ResponseError(400, "payment.invalid_type");
        payload.payment_type = options.ewalletType; // gopay, shopeepay, dsb
    } else {
        throw new ResponseError(400, "payment.invalid_type");
    }

    const midtransAuth = {
        username: env.midtrans.serverKey,
        // password: "Basic TWlkLXNlcnZlci12VEVWOTJHNlVuZzlMZXEta0Y4YUJQdkw6"
        password: ""
    };

    // 3. Request ke Midtrans Core API
    const midtransRes = await axios.post(
        env.midtrans.baseUrl,
        payload,
        { auth: midtransAuth }
    ).then(res => res.data);

    // 4. Simpan instruksi pembayaran ke DB
    let updateData = { status: "pending" };
    let responseData = {
        repair_id: repairId,
        item_name: repair.item_name,
        category: {
            id: repair.category.id,
            name: repair.category.name
        },
        customer: repair.user.fullname || repair.user.username,
        order_id: orderId,
        payment_type: paymentType,
        amount: payment.amount,
        admin_fee: payment.admin_fee,
        total_payment: grossAmount,
        status: "pending"
    };

    const exists = await prismaClient.repairPayment.findUnique({
        where: { order_id: orderId, user_id: userId, repair_id: repairId, status: "pending" }
    });

    if (paymentType === "bank_transfer") {
        if (!["bca", "bni", "bri", "bsi", "cimb"].includes(options.bankCode)) {
            throw new ResponseError(400, "payment.invalid_type");
        }
        const va = midtransRes.va_numbers?.[0];
        updateData.payment_type = 'bank_transfer';
        updateData.va_number = exists.va_number || va?.va_number;
        updateData.bank_code = exists.bank_code || va?.bank;
        updateData.expired_at = (midtransRes.expiry_time && !exists.expired_at) ? wibToUtc(midtransRes.expiry_time) : exists.expired_at;
        responseData.va_number = exists.va_number || va?.va_number;
        responseData.bank = exists.bank_code || va?.bank;
        responseData.expiry = exists.expired_at || midtransRes.expiry_time;
        // responseData.instructions = midtransRes.pdf_url || null;
    } else if (paymentType === "qris") {
        updateData.payment_type = 'qris';
        updateData.qris_url = exists.qris_url || midtransRes.actions?.find(a => a.name === "generate-qr-code")?.url || midtransRes.qr_url;
        updateData.expired_at = (midtransRes.expiry_time && !exists.expired_at) ? wibToUtc(midtransRes.expiry_time) : exists.expired_at;
        responseData.qris_url = exists.qris_url || updateData.qris_url;
        responseData.expiry = exists.expired_at || midtransRes.expiry_time;
    } else if (paymentType === "e_wallet") {
        // gopay: deeplink_url,
        updateData.payment_type = 'e_wallet';
        updateData.deeplink_url = exists.deeplink_url || midtransRes.actions?.find(a => a.name === "deeplink-redirect")?.url;
        updateData.ewallet_type = options.ewalletType;
        updateData.expired_at = (midtransRes.expiry_time && !exists.expired_at) ? wibToUtc(midtransRes.expiry_time) : exists.expired_at;
        responseData.ewallet_type = exists.ewallet_type || options.ewalletType;
        responseData.deeplink_url = exists.deeplink_url || updateData.deeplink_url;
        responseData.expiry = exists.expired_at || midtransRes.expiry_time;
    }

    await prismaClient.repairPayment.update({
        where: { id: payment.id },
        data: updateData
    });

    // 5. Kembalikan instruksi pembayaran ke frontend
    return responseData;
};

async function getRepairPaymentStatus(userId, repairId) {
    // 1. Ambil repair dan payment
    const repair = await prismaClient.repair.findUnique({
        where: { id: repairId, user_id: userId },
        include: {
            repairPayments: true,
            category: true,
            user: true
        }
    });
    if (!repair) throw new ResponseError(404, "repair.not_found");
    if (repair.user_id !== userId) throw new ResponseError(403, "repair.forbidden");

    const payment = repair.repairPayments[0];
    if (!payment) throw new ResponseError(404, "repair.payment_not_found");

    // 2. Format response
    return {
        id: payment.id,
        order_id: payment.order_id,
        amount: payment.amount,
        admin_fee: payment.admin_fee,
        total: payment.amount + (payment.admin_fee || 0),
        customer: repair.user.fullname || repair.user.username,
        item_name: repair.item_name,
        category: {
            id: repair.category.id,
            name: repair.category.name
        },
        expired_at: payment.expired_at ? payment.expired_at.toISOString() : null,
        status: payment.status,
        payment_type: payment.payment_type,
        bank_code: payment.bank_code,
        va_number: payment.va_number,
        ewallet_type: payment.ewallet_type,
        deeplink_url: payment.deeplink_url,
        qris_url: payment.qris_url,
        paid_at: payment.paid_at ? payment.paid_at.toISOString() : null
    };
}

export default {
    getRepairPrice,
    createRepair,
    getRepairDetail,
    requestRepairPayment,
    getRepairPaymentStatus
}