import { faker } from '@faker-js/faker';

/**
 * Seeder untuk data repair, status history, images, dan payment/transaction
 * @param {PrismaClient} prisma
 * @param {Array} users - array user dari DB
 * @param {Array} categories - array category dari DB
 * @param {Array} addresses - array address dari DB
 * @param {Array} phones - array phone dari DB
 */
export async function repairSeeder(prisma, users, categories, addresses, phones) {
    const repairCount = 20;
    const paymentStatuses = ['pending', 'paid', 'expired', 'failed', 'cancelled'];
    const statusSteps = {
        pending: ['request_submitted'],
        paid: ['request_submitted', 'confirmed', 'under_repair', 'completed'],
        expired: ['request_submitted', 'failed'],
        failed: ['request_submitted', 'failed'],
        cancelled: ['request_submitted', 'failed'],
    };
    const repairTypes = ['minor_repair', 'moderate_repair', 'major_repair'];
    const repairLocations = ['my_location', 'warehouse'];
    const imageTypes = ['front_view', 'close_up_damage'];

    for (let i = 0; i < repairCount; i++) {
        // Random user, category, address, phone
        const user = users[i % users.length];
        const category = categories[Math.floor(Math.random() * categories.length)];
        const address = addresses[Math.floor(Math.random() * addresses.length)];
        const phone = phones[Math.floor(Math.random() * phones.length)];

        // Random payment status
        const paymentStatus = paymentStatuses[Math.floor(Math.random() * paymentStatuses.length)];

        // Create repair
        const repair = await prisma.repair.create({
            data: {
                user_id: user.id,
                item_name: faker.commerce.productName(),
                description: faker.lorem.sentence(),
                item_weight: faker.number.int({ min: 1, max: 15 }),
                address_id: address.id,
                category_id: category.id,
                repair_type: repairTypes[Math.floor(Math.random() * repairTypes.length)],
                phone_id: phone.id,
                repair_location: repairLocations[Math.floor(Math.random() * repairLocations.length)],
            }
        });

        // Create payment/transaction
        const amount = faker.number.int({ min: 50000, max: 500000 });
        const adminFee = Math.floor(amount * 0.05);
        const paymentType = ['bank_transfer', 'e_wallet', 'qris'][Math.floor(Math.random() * 3)];
        let paymentData = {
            repair_id: repair.id,
            user_id: user.id,
            order_id: `REPAIR-${repair.id}-${faker.string.alphanumeric(8)}`,
            payment_type: paymentType,
            amount,
            admin_fee: adminFee,
            status: paymentStatus,
        };
        if (paymentType === 'bank_transfer') {
            paymentData.bank_code = ['bca', 'bni', 'bri'][Math.floor(Math.random() * 3)];
            paymentData.va_number = faker.finance.accountNumber();
        } else if (paymentType === 'e_wallet') {
            paymentData.ewallet_type = ['gopay', 'shopeepay'][Math.floor(Math.random() * 2)];
            paymentData.deeplink_url = faker.internet.url();
        } else if (paymentType === 'qris') {
            paymentData.qris_url = faker.internet.url();
        }
        if (paymentStatus === 'paid') {
            paymentData.paid_at = faker.date.recent({ days: 10 });
        } else if (['expired', 'failed', 'cancelled'].includes(paymentStatus)) {
            paymentData.expired_at = faker.date.recent({ days: 10 });
        }
        await prisma.repairPayment.create({ data: paymentData });

        // Create status histories (berurutan sesuai payment status)
        const statusPath = statusSteps[paymentStatus];
        for (let j = 0; j < statusPath.length; j++) {
            await prisma.repairStatusHistory.create({
                data: {
                    repair_id: repair.id,
                    status: statusPath[j],
                    status_detail: statusPath[j] === "request_submitted"
                        ? "repair.status.request_submitted_detail"
                        : statusPath[j] === "confirmed"
                            ? "repair.status.confirmed_detail"
                            : statusPath[j] === "under_repair"
                                ? "repair.status.under_repair_detail"
                                : statusPath[j] === "completed"
                                    ? "repair.status.completed_detail"
                                    : "repair.status.failed_detail",
                    updated_by: user.id
                }
            });
        }

        // Create repair images (1-3 per repair)
        const imageCount = Math.floor(Math.random() * 3) + 1;
        for (let k = 1; k <= imageCount; k++) {
            await prisma.repairImage.create({
                data: {
                    repair_id: repair.id,
                    image_path: `https://dummyimage.com/600x400/000/fff&text=repair-post-${k}`,
                    image_name: `repair-post-${k}.jpg`,
                    image_size: 1024 * (Math.floor(Math.random() * 200) + 50), // 50-250 KB
                    image_type: imageTypes[k % imageTypes.length]
                }
            });
        }
    }
}