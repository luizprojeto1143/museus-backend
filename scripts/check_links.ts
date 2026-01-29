
import { PrismaClient } from "@prisma/client";
import axios from "axios";

const prisma = new PrismaClient();

async function main() {
    const allWorks = await prisma.work.findMany({
        select: {
            id: true,
            title: true,
            imageUrl: true,
        }
    });

    console.log(`Checking ${allWorks.length} works for broken images...`);

    for (const work of allWorks) {
        if (!work.imageUrl) {
            console.log(`[MISSING] ${work.title} has no URL`);
            continue;
        }

        try {
            const response = await axios.head(work.imageUrl, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            if (response.status !== 200) {
                console.log(`[FAIL] ${work.title}: Status ${response.status} (${work.imageUrl})`);
            } else {
                // console.log(`[OK] ${work.title}`);
            }
        } catch (error: any) {
            // Some servers don't support HEAD, try GET with range just in case or just assume fail if simple check fails
            // But for wikipedia/commons, HEAD usually works.
            console.log(`[ERROR] ${work.title}: ${error.message} (${work.imageUrl})`);
        }
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
