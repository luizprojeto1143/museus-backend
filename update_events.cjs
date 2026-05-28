
const fs = require('fs');
const path = 'C:\\Users\\luiza\\Documents\\PicWish\\Cultura Viva\\museus-backend\\src\\routes\\events.ts';
let content = fs.readFileSync(path, 'utf8');

// For POST /
content = content.replace('minMinutesForCertificate: minMinutesForCertificate ? Number(minMinutesForCertificate) : null,', 'minMinutesForCertificate: minMinutesForCertificate ? Number(minMinutesForCertificate) : null,\n        producerId: user.role === Role.PRODUCER ? user.id : undefined,');

// For PUT /:id
content = content.replace('minMinutesForCertificate: minMinutesForCertificate !== undefined ? Number(minMinutesForCertificate) : undefined,', 'minMinutesForCertificate: minMinutesForCertificate !== undefined ? Number(minMinutesForCertificate) : undefined,\n        producerId: user.role === Role.PRODUCER ? user.id : undefined,');

fs.writeFileSync(path, content, 'utf8');
console.log('Updated events.ts');

