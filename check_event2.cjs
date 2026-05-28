
const fs = require('fs');
const path = 'C:\\Users\\luiza\\Documents\\PicWish\\Cultura Viva\\museus-backend\\prisma\\schema.prisma';
let content = fs.readFileSync(path, 'utf8');

// Ensure Event has producer
content = content.replace('  // Certificate Settings', '  producerId          String?\n  producer            User?   @relation(\"ProducerEvents\", fields: [producerId], references: [id])\n\n  // Certificate Settings');
fs.writeFileSync(path, content, 'utf8');
console.log('Added producer to Event');

