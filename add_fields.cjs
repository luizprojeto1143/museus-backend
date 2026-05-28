
const fs = require('fs');
const path = 'C:\\\\Users\\\\luiza\\\\Documents\\\\PicWish\\\\Cultura Viva\\\\museus-backend\\\\prisma\\\\schema.prisma';
let content = fs.readFileSync(path, 'utf8');

const regex = /model CulturalProject \\{[\\s\\S]*?attachments Json\\?\\n/m;
if(regex.test(content)) {
    content = content.replace(regex, (match) => {
        return match + '\n  // NF Fields\n  notaFiscalUrl     String?\n  notaFiscalNumber  String?\n  notaFiscalDate    DateTime?\n';
    });
    fs.writeFileSync(path, content, 'utf8');
    console.log('Fields added to CulturalProject');
} else {
    console.log('Regex did not match CulturalProject');
}

