import { loginUserValidation, registerUserValidation, resendEmailVerificationOtpValidation, resetPasswordValidation, sendResetPasswordOtpValidation, verifyEmailValidation, verifyResetPasswordOTPValidation } from "../validations/authValidation.js";
import { validate } from "../validations/validation.js";
import { prismaClient } from "../application/database.js";
import { ResponseError } from "../errors/responseError.js";
import bcrypt from "bcrypt";
import { logger } from "../application/logging.js";
import { downloadAndSaveProfileIamge, sendEmailVerificationOTP, sendResetPasswordOTPHelper } from "../helpers/authHelper.js";
import { generateJWT } from "../helpers/jwtHelper.js";
import { getPictureUrl, publicPathToDiskPath } from "../helpers/fileHelper.js";

const register = async (requestBody, reqObject) => {
    // Input validation
    const userData = validate(registerUserValidation, requestBody, reqObject);

    // Check existing email
    const userExistsByEmail = await prismaClient.user.findUnique({
        where: { email: userData.email }
    });
    if (userExistsByEmail) {
        // Return 400 is user email is already verified
        if (userExistsByEmail.is_email_verified) {
            throw new ResponseError(400, "auth.email_already_registered");
        }

        // Username must be equal with unverified user
        if (userExistsByEmail.username !== userData.username) {
            throw new ResponseError(400, "auth.email_already_registered");
        }

        // Resend OTP
        await sendEmailVerificationOTP(userExistsByEmail);

        return {
            message: "auth.otp_resend",
            email: userExistsByEmail.email
        };
    }

    // Check existing username
    const userExistsByUsername = await prismaClient.user.findUnique({
        where: { username: userData.username }
    });
    if (userExistsByUsername) {
        throw new ResponseError(400, "auth.username_already_registered");
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(userData.password, 10);

    // Save new user
    const newUser = await prismaClient.user.create({
        data: {
            username: userData.username,
            fullname: userData.username,
            email: userData.email,
            password: hashedPassword,
            is_email_verified: false,
            is_active: true
        }
    });

    // Create default profile picture using ui-avatars
    await downloadAndSaveProfileIamge(newUser);

    // Generate OTP & save to EmailVerification
    await sendEmailVerificationOTP(newUser);

    // Return data without password
    return {
        id: newUser.id,
        fullname: newUser.fullname,
        username: newUser.username,
        email: newUser.email,
        profile_picture: `${reqObject.protocol}://${reqObject.get('host')}/assets/profiles/${newUser.username}.png`
    }
}

const verifyEmail = async (requestBody, reqObject) => {
    const data = validate(verifyEmailValidation, requestBody, reqObject);

    // Find user
    const user = await prismaClient.user.findUnique({
        where: { email: data.email }
    });
    if (!user) throw new ResponseError(404, "auth.user_not_found");

    // Find unused & valid OTP
    const otpRecord = await prismaClient.emailVerification.findFirst({
        where: {
            user_id: user.id,
            verification_code: data.otp,
            is_used: false,
            expires_at: { gte: new Date() }
        }
    });
    if (!otpRecord) throw new ResponseError(400, "auth.otp_code_incorrect_or_expired");

    // Update user's email status & OTP
    await prismaClient.user.update({
        where: { id: user.id },
        data: {
            is_email_verified: true,
            email_verified_at: new Date()
        }
    });
    await prismaClient.emailVerification.update({
        where: { id: otpRecord.id },
        data: {
            is_used: true,
            verified_at: new Date()
        }
    });

    return {
        email: user.email,
        verified: true,
    }
}

// Resend Email Verification OTP
const resendEmailVerificationOtp = async (requestBody, reqObject) => {
    const data = validate(resendEmailVerificationOtpValidation, requestBody, reqObject);

    // Find user
    const user = await prismaClient.user.findUnique({
        where: { email: data.email }
    });
    if (!user) throw new ResponseError(404, "auth.email_not_found");
    if (user.is_email_verified) throw new ResponseError(400, "auth.email_already_registered");

    // Generate OTP & save to EmailVerification
    await sendEmailVerificationOTP(user);

    return {
        message: "auth.otp_resend",
        email: user.email
    };
}

const login = async (requestBody, reqObject) => {
    const data = validate(loginUserValidation, requestBody, reqObject);

    // Find user from username or email
    const user = await prismaClient.user.findFirst({
        where: {
            OR: [
                { email: data.identifier },
                { username: data.identifier }
            ]
        }
    });
    if (!user) throw new ResponseError(401, 'auth.username_or_password_wrong');

    // Check password
    const passwordMatch = await bcrypt.compare(data.password, user.password);
    if (!passwordMatch) throw new ResponseError(401, 'auth.username_or_password_wrong');

    // Check if account email is verified & account status is active
    if (!user.is_active) throw new ResponseError(403, 'auth.account_is_inactive');
    if (!user.is_email_verified) throw new ResponseError(403, 'auth.email_not_verified');

    const profilePicture = (!user.profile_picture.startsWith('http') || !user.profile_picture.startsWith('https'))
        ? getPictureUrl(reqObject, user.profile_picture)
        : user.profile_picture

    return {
        token: generateJWT(user),
        user: {
            id: user.id,
            fullname: user.fullname,
            username: user.username,
            email: user.email,
            profile_picture: profilePicture
        }
    };
}

const sendResetPasswordOTP = async (requestBody, reqObject) => {
    const data = validate(sendResetPasswordOtpValidation, requestBody, reqObject);

    // Find user
    const user = await prismaClient.user.findUnique({
        where: { email: data.email }
    });
    if (!user) throw new ResponseError(404, 'auth.user_not_found');

    // Generate OTP & save the data to password reset table
    await sendResetPasswordOTPHelper(user);

    return {
        message: 'auth.otp_send'
    }
}

const resetPassword = async (requestBody, reqObject) => {
    const data = validate(resetPasswordValidation, requestBody, reqObject);

    // Find user
    const user = await prismaClient.user.findUnique({
        where: { email: data.email }
    });
    if (!user) throw new ResponseError(404, 'auth.user_not_found');

    // Find Valid OTP
    const otpRecord = await prismaClient.passwordReset.findFirst({
        where: {
            user_id: user.id,
            otp: data.otp,
            is_used: false,
            expires_at: { gte: new Date() }
        }
    });
    if (!otpRecord) throw new ResponseError(404, 'auth.otp_code_incorrect_or_expired');

    // Update password
    const hashedPassword = await bcrypt.hash(data.newPassword, 10);
    await prismaClient.user.update({
        where: { id: user.id },
        data: {
            password: hashedPassword
        }
    });

    // Mark OTP as used
    await prismaClient.passwordReset.update({
        where: { id: otpRecord.id },
        data: { is_used: true }
    });

    return {
        message: 'auth.reset_password_successful'
    }
}

const verifyResetPasswordOTP = async (requestBody, reqObject) => {
    const data = validate(verifyResetPasswordOTPValidation, requestBody, reqObject);

    const userData = await prismaClient.user.findUnique({
        where: { email: data.email },
    });
    if (!userData) throw new ResponseError(404, "user.not_found");

    const resetPasswordData = await prismaClient.passwordReset.findFirst({
        where: {
            user_id: userData.id,
            otp: data.otp
        }
    });
    if (!resetPasswordData) throw new ResponseError(404, "auth.reset_password_otp_not_found");

    return {
        id: resetPasswordData.id,
        otp: resetPasswordData.otp,
        user: {
            id: userData.id,
            email: userData.email,
        }
    }
}

export default {
    register, verifyEmail, resendEmailVerificationOtp, login, sendResetPasswordOTP, resetPassword, verifyResetPasswordOTP
}