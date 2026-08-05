const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'prisma/seed.ts');
let content = fs.readFileSync(filePath, 'utf8');

// We need to add qrCodeEntrada to all equipamentoCultural.create instances.
content = content.replace(/ativo: true\s*\n\s*\}/g, 'ativo: true,\n                qrCodeEntrada: "galeria-qr"\n            }');

content = content.replace(/estado: "MG"\s*\n\s*\}\s*\n\s*\}\);\s*\n\s*\}\s*\n\s*\/\/ Criar Centro Cultural filho/g, 'estado: "MG",\n                qrCodeEntrada: "sede-betim-qr"\n            }\n        });\n    }\n\n    // Criar Centro Cultural filho');

content = content.replace(/estado: "MG"\s*\n\s*\}\s*\n\s*\}\);\s*\n\s*\}\s*\n\s*\/\/ Criar admin/g, 'estado: "MG",\n                qrCodeEntrada: "teatro-betim-qr"\n            }\n        });\n    }\n\n    // Criar admin');

fs.writeFileSync(filePath, content, 'utf8');
console.log("Fixed seed.ts");
