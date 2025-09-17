import express from "express";
import { authMiddleware } from "../middlewares/authMiddleware.js";
import userController from "../controllers/userController.js";
import addressController from "../controllers/addressController.js";
import phoneController from "../controllers/phoneController.js";
import { geocodeAddress } from "../application/nodeGeocoder.js";
import { uploadProfilePictureMiddleware } from "../middlewares/uploadMiddleware.js";
import categoryController from "../controllers/categoryController.js";
import { uploadDonationImageMiddleware } from "../middlewares/donations/uploadDonationMiddleware.js";
import donationController from "../controllers/donationController.js";
import { env } from "../application/env.js";
import { uploadBarterImageMiddleware } from "../middlewares/barter/uploadBarterImageMiddleware.js";
import barterController from "../controllers/barterController.js";
import { uploadBarterApplicationImageMiddleware } from "../middlewares/barter/uploadBarterApplicationImagMiddleware.js";
import barterApplicationController from "../controllers/barterApplicationController.js";
import { uploadBorrowImageMiddleware } from "../middlewares/borrow/uploadBorrowImageMiddleware.js";
import borrowController from "../controllers/borrowController.js";
import borrowApplicationController from "../controllers/borrowApplicationController.js";
import borrowHistoryController from "../controllers/borrowHistoryController.js";
import recycleController from "../controllers/recycleController.js";
import { uploadRecycleImageMiddleware } from "../middlewares/recycle/uploadRecycleImageMiddleware.js";
import recycleHistoryController from "../controllers/recycleHistoryController.js";
import repairController from "../controllers/repairController.js";
import { uploadRepairImageMiddleware } from "../middlewares/repair/uploadRepairImageMiddleware.js";
import paymentNotificationController from "../controllers/paymentNotificationController.js";
import repairHistoryController from "../controllers/repairHistoryController.js";
import notificationController from "../controllers/notificationController.js";
import newsController from "../controllers/newsController.js";

const userRouter = express.Router();
// userRouter.use(authMiddleware);

// User API
userRouter.get('/users/current', authMiddleware, userController.currentUser);
userRouter.patch('/users/current', authMiddleware, userController.updateCurrentUser);
userRouter.patch('/users/current/profile-picture', authMiddleware, uploadProfilePictureMiddleware, userController.updateProfilePicture)
userRouter.get('/users/current/notifications', authMiddleware, notificationController.getNotifications);
userRouter.patch('/users/current/notifications/:notificationId/read', authMiddleware, notificationController.readNotification);
userRouter.patch('/users/current/notifications/read-all', authMiddleware, notificationController.readAllNotifications);

// Categories API
userRouter.get('/categories', authMiddleware, categoryController.getCategories);

// News API
userRouter.get('/news', authMiddleware, newsController.listNews);
userRouter.get('/news/:newsId', authMiddleware, newsController.detailNews);

// Address API
userRouter.get('/users/current/addresses', authMiddleware, addressController.getAddresses);
userRouter.post('/users/current/addresses', authMiddleware, addressController.createAddress);
userRouter.get('/users/current/addresses/:addressId', authMiddleware, addressController.getAddressById);
userRouter.patch('/users/current/addresses/:addressId', authMiddleware, addressController.updateAddress);
userRouter.delete('/users/current/addresses/:addressId', authMiddleware, addressController.deleteAddress);

// Phone API
userRouter.get('/users/current/phones', authMiddleware, phoneController.getPhones);
userRouter.post('/users/current/phones', authMiddleware, phoneController.createPhone);
userRouter.get('/users/current/phones/:phoneId', authMiddleware, phoneController.getPhoneById);
userRouter.patch('/users/current/phones/:phoneId', authMiddleware, phoneController.updatePhone);
userRouter.delete('/users/current/phones/:phoneId', authMiddleware, phoneController.deletePhone);

// Donation API
userRouter.get('/users/current/donations', authMiddleware, donationController.getDonations);
userRouter.get('/users/current/donations/:donationId', authMiddleware, donationController.getDonationDetail);
userRouter.post('/donations', authMiddleware, uploadDonationImageMiddleware, donationController.createDonation);

// Barter API
userRouter.get('/barters', authMiddleware, barterController.getBarters);  //discover barter
userRouter.post('/barters', authMiddleware, uploadBarterImageMiddleware, barterController.createBarter);  //create barter
userRouter.get('/barters/:barterId', authMiddleware, barterController.getBarterDetail); //Detail other user barter, access from GET /barters
userRouter.post('/barters/:barterId/request', authMiddleware, uploadBarterApplicationImageMiddleware, barterApplicationController.createBarterApplication);

userRouter.get('/users/current/barters', authMiddleware, barterController.getBarterHistory);  //get user barters (my_items & other_items (incoming requests)) list
userRouter.get('/users/current/barters/:barterId', authMiddleware, barterController.getMyBarterDetail);  //get my_items detail
userRouter.get('/users/current/barter-requests/:requestId', authMiddleware, barterApplicationController.getMyRequestDetail);  //get other_items detail
userRouter.post('/users/current/barters/:barterId/mark-as-completed', authMiddleware, barterController.markBarterAsCompleted);
userRouter.get('/users/current/barters/:barterId/requests/:requestId', authMiddleware, barterController.getMyBarterIncomingRequestDetail);  //get incoming request detail
userRouter.post('/users/current/barters/:barterId/requests/:requestId/process', authMiddleware, barterController.processIncomingRequest);

// Borrow API
userRouter.get('/borrows', authMiddleware, borrowController.getBorrows);
userRouter.post('/borrows', authMiddleware, uploadBorrowImageMiddleware, borrowController.createBorrow);
userRouter.get('/borrows/:borrowId', authMiddleware, borrowController.getBorrowDetail);
userRouter.post('/borrows/:borrowId/request', authMiddleware, borrowApplicationController.createBorrowApplication);

userRouter.get('/users/current/borrows', authMiddleware, borrowHistoryController.getBorrowHistory);
userRouter.get('/users/current/borrows/:borrowId', authMiddleware, borrowController.getMyBorrowDetail);
userRouter.get('/users/current/borrow-requests/:requestId', authMiddleware, borrowHistoryController.getMyBorrowRequestDetail);
userRouter.post('/users/current/borrows/:borrowId/mark-as-lent', authMiddleware, borrowController.markBorrowAsLent);
userRouter.post('/users/current/borrows/:borrowId/mark-as-returned', authMiddleware, borrowController.markBorrowAsReturned);
userRouter.post('/users/current/borrows/:borrowId/mark-as-completed', authMiddleware, borrowController.markBorrowAsCompleted);
userRouter.get('/users/current/borrows/:borrowId/requests/:requestId', authMiddleware, borrowController.getMyBorrowIncomingRequestDetail);
userRouter.post('/users/current/borrows/:borrowId/requests/:requestId/extend', authMiddleware, borrowApplicationController.extendBorrowApplication);
userRouter.post('/users/current/borrows/:borrowId/requests/:requestId/process', authMiddleware, borrowController.processIncomingRequest);

// Recycle
userRouter.post('/recycles', authMiddleware, uploadRecycleImageMiddleware, recycleController.createRecycle);
userRouter.get('/recycle-locations', authMiddleware, recycleController.getRecycleLocations);
userRouter.get('/recycle-locations/:recycleLocationId', authMiddleware, recycleController.getRecycleLocationDetail);

userRouter.get('/users/current/recycles', authMiddleware, recycleHistoryController.getMyRecycleHistory);
userRouter.get('/users/current/recycles/:recycleId', authMiddleware, recycleHistoryController.getMyRecycleDetail);

// Repair
userRouter.get('/categories/:categoryId/repair-prices', authMiddleware, repairController.getRepairPrice);
userRouter.post('/repairs', authMiddleware, uploadRepairImageMiddleware, repairController.createRepair);
userRouter.get('/repairs/:repairId', authMiddleware, repairController.getRepairDetail);
userRouter.post('/repairs/:repairId/pay', authMiddleware, repairController.requestRepairPayment);
userRouter.get('/repairs/:repairId/payment-status', authMiddleware, repairController.getRepairPaymentStatus);

userRouter.get('/users/current/repairs', authMiddleware, repairHistoryController.getMyRepairHistory);
userRouter.get('/users/current/repairs/:repairId', authMiddleware, repairHistoryController.getMyRepairDetail);

userRouter.post('/payment/notification', paymentNotificationController.midtransNotification);

userRouter.get('/test/:query', async (req, res, next) => {
    // console.log(`Query: ${req.params.query}`);
    const result = await geocodeAddress(req.params.query)
    res.json({
        data: result
    });
});

// userRouter.get('/tes/pexels/:query', async (req, res) => {
//     const response = await fetch(`https://api.pexels.com/v1/search?query=${req.params.query}`, {
//         headers: {
//             'Authorization': 'EXoKdHXVmyVkHkLtVatSDz5zRh0EhY4zFwWTJY0a5XXWDI7pn2Cy9ija'
//         }
//     });
//     const data = await response.json();
//     res.json({
//         data: data.photos[0].src.medium
//     });
// })

export {
    userRouter
}