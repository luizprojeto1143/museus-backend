import fs from 'fs';
import path from 'path';

function replaceInDir(dir, replacements) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      replaceInDir(fullPath, replacements);
    } else if (fullPath.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      let changed = false;
      
      for (const [from, to] of replacements) {
        if (content.includes(from)) {
          content = content.split(from).join(to);
          changed = true;
        }
      }
      
      if (changed) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log('Fixed:', fullPath);
      }
    }
  }
}

const replacements = [
  ['from "../services/stripeService.js"', 'from "../../services/stripeService.js"'],
  ['from "./audit.js"', 'from "../governance/audit.js"'],
  ['from \'./audit.js\'', 'from \'../governance/audit.js\''],
  ['import("./upload.js")', 'import("../../routes/upload.js")'],
  ['from "../services/certificate-engine.js"', 'from "../../services/certificate-engine.js"'],
  ['from "../../logger/pino.logger.js"', 'from "../../infrastructure/logger/pino.logger.js"'],
  ['from "../logger/pino.logger.js"', 'from "../../infrastructure/logger/pino.logger.js"']
];

replaceInDir(path.join(process.cwd(), 'src'), replacements);
