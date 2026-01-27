import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function dropConstraint() {
    try {
        console.log('Dropping constraint Visitor_email_key...');
        await prisma.$executeRawUnsafe(`ALTER TABLE "Visitor" DROP CONSTRAINT IF EXISTS "Visitor_email_key";`);
        console.log('Constraint dropped.');

        console.log('Dropping index Visitor_email_key...');
        await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "Visitor_email_key";`);
        console.log('Index dropped.');
    } catch (error) {
        console.error('Error dropping constraint:', error);
    } finally {
        await prisma.$disconnect();
    }
}

dropConstraint();
