import fs from 'fs';
import path from 'path';

const domainsDir = path.join(process.cwd(), 'src', 'domains');

function fixImportsRecursively(dir) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      fixImportsRecursively(fullPath);
    } else if (fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Double quotes
      content = content.replace(/from "\.\.\/prisma\.js"/g, 'from "../../prisma.js"');
      content = content.replace(/from "\.\.\/middleware\/(.*)"/g, 'from "../../middleware/$1"');
      content = content.replace(/from "\.\.\/services\/(.*)"/g, 'from "../../services/$1"');
      content = content.replace(/from "\.\.\/logger\/(.*)"/g, 'from "../../logger/$1"');
      content = content.replace(/from "\.\.\/schemas\/(.*)"/g, 'from "../../schemas/$1"');
      
      // Single quotes
      content = content.replace(/from '\.\.\/prisma\.js'/g, "from '../../prisma.js'");
      content = content.replace(/from '\.\.\/middleware\/(.*)'/g, "from '../../middleware/$1'");
      content = content.replace(/from '\.\.\/services\/(.*)'/g, "from '../../services/$1'");
      content = content.replace(/from '\.\.\/logger\/(.*)'/g, "from '../../logger/$1'");
      content = content.replace(/from '\.\.\/schemas\/(.*)'/g, "from '../../schemas/$1'");
      
      // Fix prisma import from index.js
      content = content.replace(/from "\.\.\/\.\.\/index\.js"/g, 'from "../../prisma.js"');
      content = content.replace(/from '\.\.\/\.\.\/index\.js'/g, "from '../../prisma.js'");
      content = content.replace(/from "\.\.\/index\.js"/g, 'from "../../prisma.js"');
      content = content.replace(/from '\.\.\/index\.js'/g, "from '../../prisma.js'");
      
      fs.writeFileSync(fullPath, content, 'utf8');
    }
  }
}

fixImportsRecursively(domainsDir);
console.log('Imports ajustados nos domínios.');
