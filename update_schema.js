
import fs from 'fs';
const path = 'C:\\Users\\luiza\\Documents\\PicWish\\Cultura Viva\\museus-backend\\prisma\\schema.prisma';
let content = fs.readFileSync(path, 'utf8');

// Update User model
content = content.replace('stripeCustomerId String? @unique', 'stripeCustomerId String? @unique\n  stripeConnectId String? @unique\n  nfseStatus String?');

content = content.replace('producerConversations Conversation[]         @relation("ProducerConversations")', 'producerConversations Conversation[]         @relation("ProducerConversations")\n  producerEvents        Event[]                @relation("ProducerEvents")');

// Update Event model
content = content.replace('coverUrl            String? // Alias for cover image (used in projects->events)', 'coverUrl            String? // Alias for cover image (used in projects->events)\n  producerId          String?\n  producer            User?   @relation("ProducerEvents", fields: [producerId], references: [id])');

fs.writeFileSync(path, content, 'utf8');
console.log('Done');

