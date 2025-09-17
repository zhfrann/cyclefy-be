import bcrypt from "bcrypt";

export default async function userSeeder(prisma) {
    const users = [
        {
            fullname: "Alif Fikri",
            username: "aliffikri",
            email: "alif@example.com",
            password: await bcrypt.hash("password123", 10),
            is_email_verified: true,
            email_verified_at: new Date(),
            is_active: true,
            profile_picture: "https://ui-avatars.com/api/?name=Alif%20Fikri&background=random"
        },
        {
            fullname: "Dewi Lestari",
            username: "dewi.lestari",
            email: "dewi@example.com",
            password: await bcrypt.hash("password123", 10),
            is_email_verified: true,
            email_verified_at: new Date(),
            is_active: true,
            profile_picture: "https://ui-avatars.com/api/?name=Dewi%20Lestari&background=random"
        },
        {
            fullname: "Budi Santoso",
            username: "budisantoso",
            email: "budi@example.com",
            password: await bcrypt.hash("password123", 10),
            is_email_verified: true,
            email_verified_at: new Date(),
            is_active: true,
            profile_picture: "https://ui-avatars.com/api/?name=Budi%20Santoso&background=random"
        },
        {
            fullname: "Siti Aminah",
            username: "siti.aminah",
            email: "sitiaminah@example.com",
            password: await bcrypt.hash("password123", 10),
            is_email_verified: true,
            email_verified_at: new Date(),
            is_active: true,
            profile_picture: "https://ui-avatars.com/api/?name=Siti%20Aminah&background=random"
        },
        {
            fullname: "Admin",
            username: "admin",
            email: "admin@example.com",
            password: await bcrypt.hash("password123", 10),
            is_email_verified: true,
            email_verified_at: new Date(),
            is_active: true,
            profile_picture: "https://ui-avatars.com/api/?name=Admin&background=random"
        }
    ];

    const createdUsers = [];
    for (const user of users) {
        const created = await prisma.user.upsert({
            where: { email: user.email },
            update: {},
            create: user,
        });
        // Buat email_verification dummy (optional)
        await prisma.emailVerification.create({
            data: {
                user_id: created.id,
                verification_code: "1234",
                expires_at: new Date(Date.now() + 10 * 60 * 1000),
                is_used: true,
                verified_at: new Date()
            }
        });
        createdUsers.push(created);
    }
    return createdUsers;
}