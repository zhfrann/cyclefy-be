import { env } from "./application/env.js";
import { logger } from "./application/logging.js";
import { web } from "./application/web.js";
import cron from "node-cron";
import { checkAndUpdateOverdueBorrows } from "./helpers/borrowHelper.js";

web.listen(env.port, "::", () => {
    logger.info(`App start on port ${env.port}`);
});

// Jalankan setiap 1 jam
cron.schedule("0 0 * * * *", async () => {
    try {
        await checkAndUpdateOverdueBorrows();
        console.log("Checked overdue borrows at", new Date());
    } catch (err) {
        // Handle error, bisa log ke file
        console.error("Error checking overdue borrows:", err);
    }
});

// Jalankan setiap 24 jam (00:00:00)
// cron.schedule("0 0 0 * * *", async () => {
//     try {
//         await checkAndUpdateOverdueBorrows();
//         console.log("Checked overdue borrows at", new Date());
//     } catch (err) {
//         // Handle error, bisa log ke file
//         console.error("Error checking overdue borrows:", err);
//     }
// });