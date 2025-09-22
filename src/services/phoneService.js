import { prismaClient } from "../application/database.js";
import { ResponseError } from "../errors/responseError.js";
import { createPhoneValidation, updatePhoneValidation } from "../validations/phoneValidation.js";
import { validate } from "../validations/validation.js";

const getPhones = async (userId) => {
    const phones = await prismaClient.phone.findMany({
        where: { user_id: userId }
    });
    if (!phones) throw new ResponseError(404, 'phone.not_found');
    return phones;
}

const getPhoneById = async (userId, phoneId) => {
    const phones = await prismaClient.phone.findUnique({
        where: {
            id: phoneId,
            user_id: userId
        }
    });
    if (!phones) throw new ResponseError(404, 'phone.not_found');
    return phones;
}

const createPhone = async (userId, requestBody, reqObject) => {
    const data = validate(createPhoneValidation, requestBody, reqObject);

    // Check if number is duplicate
    const numberExists = await prismaClient.phone.findFirst({
        where: {
            user_id: userId,
            number: data.number
        }
    });
    if (numberExists) throw new ResponseError(400, 'phone.duplicate');

    // Create & return new phone data
    return await prismaClient.phone.create({
        data: {
            user_id: userId,
            number: data.number,
        }
    });
}

const updatePhone = async (userId, phoneId, requestBody, reqObject) => {
    const updateData = validate(updatePhoneValidation, requestBody, reqObject);

    // Make sure this phone number is owned by current user
    const phone = await prismaClient.phone.findUnique({
        where: {
            id: phoneId,
            user_id: userId
        }
    });
    if (!phone) throw new ResponseError(404, 'phone.not_found');

    // Update phone
    await prismaClient.phone.update({
        where: { id: phoneId },
        data: updateData
    });

    return updateData;
}

const deletePhone = async (userId, phoneId) => {
    const phone = await prismaClient.phone.findUnique({
        where: {
            id: phoneId,
            user_id: userId,
        }
    });
    if (!phone) throw new ResponseError(404, 'phone.not_found');

    try {
        return await prismaClient.phone.delete({
            where: { id: phoneId }
        });
    } catch (error) {
        if (error.code === "P2003") {
            throw new ResponseError(
                400,
                "phone.delete_failed_referenced"
            );
        }
        throw new ResponseError(500, 'common.internal_server_error');
    }
}

export default {
    getPhones, getPhoneById, createPhone, updatePhone, deletePhone
}