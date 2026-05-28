
const fs = require('fs');
const path = 'C:\\Users\\luiza\\Documents\\PicWish\\Cultura Viva\\museus-backend\\prisma\\schema.prisma';
let content = fs.readFileSync(path, 'utf8');

// Ensure Event has producer
if (!content.includes('producerId          String?')) {
    content = content.replace('coverUrl            String? // Alias for cover image (used in projects->events)', 'coverUrl            String? // Alias for cover image (used in projects->events)\n  producerId          String?\n  producer            User?   @relation(\"ProducerEvents\", fields: [producerId], references: [id])');
    fs.writeFileSync(path, content, 'utf8');
    console.log('Added producer to Event');
} else {
    console.log('Producer already in Event');
}

