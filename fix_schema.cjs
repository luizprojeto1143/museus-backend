
const fs = require('fs');
const path = 'C:\\Users\\luiza\\Documents\\PicWish\\Cultura Viva\\museus-backend\\prisma\\schema.prisma';
let content = fs.readFileSync(path, 'utf8');

// Undo Tenant mistake
content = content.replace('  stripeCustomerId String? @unique\n  stripeConnectId String? @unique\n  nfseStatus String?\n  stripeConnectId  String? @unique', '  stripeCustomerId String? @unique\n  stripeConnectId  String? @unique');

// Undo User mistake if it has multiple producerEvents
content = content.replace('  producerEvents        Event[]                @relation(\"ProducerEvents\")\n  producerEvents        Event[]                @relation(\"ProducerEvents\")', '  producerEvents        Event[]                @relation(\"ProducerEvents\")');

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed');

