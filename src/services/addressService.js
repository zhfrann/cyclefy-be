import { prismaClient } from "../application/database.js";
import { geocodeAddress } from "../application/nodeGeocoder.js";
import { ResponseError } from "../errors/responseError.js";
import { createAddressValidation, updateAddressValidation } from "../validations/addressValidation.js";
import { validate } from "../validations/validation.js";

const getAddresses = async (userId) => {
    const userAddresses = await prismaClient.address.findMany({
        where: { user_id: userId }
    });
    if (!userAddresses) throw new ResponseError(404, 'address.not_found');
    return userAddresses;
}

const getAddressById = async (userId, addressId) => {
    const address = await prismaClient.address.findUnique({
        where: {
            id: addressId,
            user_id: userId
        }
    });
    if (!address) throw new ResponseError(404, 'address.not_found');
    return address;
}

const createAddress = async (userId, requestBody, reqObject) => {
    const data = validate(createAddressValidation, requestBody, reqObject);

    // Geocode address to get latitude, longitude and address details
    const geo = await geocodeAddress(data.address);
    if (!geo || geo.length === 0) throw new ResponseError(400, "address.geocode_failed");
    const addressData = {
        address_name: data.addressName,
        address: geo.formattedAddress,
        latitude: geo.latitude,
        longitude: geo.longitude,
        city: geo.city,
        state: geo.state,
        country: geo.country,
        country_code: geo.countryCode,
        zipcode: geo.zipcode,
    }

    // Create and return new address
    return await prismaClient.address.create({
        data: {
            user_id: userId,
            ...addressData
        }
    });
}

const updateAddress = async (userId, addressId, requestBody, reqObject) => {
    const updateData = validate(updateAddressValidation, requestBody, reqObject);

    // Make sure this address is owned by user
    const address = await prismaClient.address.findUnique({
        where: {
            id: addressId,
            user_id: userId
        }
    });
    if (!address) throw new ResponseError(404, 'address.not_found');

    // Geocode address to get latitude, longitude and address details
    const geo = await geocodeAddress(updateData.address);
    if (!geo || geo.length === 0) throw new ResponseError(400, "address.geocode_failed");
    const newAddressData = {
        address_name: updateData.addressName,
        address: geo.formattedAddress,
        latitude: geo.latitude,
        longitude: geo.longitude,
        city: geo.city,
        state: geo.state,
        country: geo.country,
        country_code: geo.countryCode,
        zipcode: geo.zipcode,
    }

    // Update address
    return await prismaClient.address.update({
        where: { id: addressId },
        data: {
            ...newAddressData
        }
    });
}

const deleteAddress = async (userId, addressId) => {
    const address = await prismaClient.address.findUnique({
        where: { id: addressId, user_id: userId }
    });
    if (!address) throw new ResponseError(404, "address.not_found");

    try {
        return await prismaClient.address.delete({
            where: { id: addressId }
        });
    } catch (error) {
        if (error.code === "P2003") {
            throw new ResponseError(
                400,
                "address.delete_failed_referenced"
            );
        }
        throw new ResponseError(500, 'common.internal_server_error');
    }
}

export default {
    getAddresses, getAddressById, createAddress, updateAddress, deleteAddress
}