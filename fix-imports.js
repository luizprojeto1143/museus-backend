import fs from 'fs';
import path from 'path';

const indexPath = path.join(process.cwd(), 'src', 'index.ts');
let content = fs.readFileSync(indexPath, 'utf-8');

const mapping = {
  // Cultural
  'events': 'cultural',
  'floorPlans': 'cultural',
  'heritage': 'cultural',
  'works': 'cultural',
  'spaces': 'cultural',
  'trails': 'cultural',
  'curator-notes': 'cultural',
  'equipamentos': 'cultural',
  'vestiges': 'cultural',
  'vestige-alerts': 'cultural',
  'conservation': 'cultural',
  
  // Commerce
  'bookings': 'commerce',
  'coupons': 'commerce',
  'donations': 'commerce',
  'finance': 'commerce',
  'shop': 'commerce',
  'stripe': 'commerce',
  'marketplace': 'commerce',
  'ticket-transfers': 'commerce',
  'tickets': 'commerce',
  'group-tickets': 'commerce',
  'in-person-services': 'commerce',
  
  // Experience
  'achievements': 'experience',
  'badgeRoutes': 'experience',
  'challenges': 'experience',
  'collectibles': 'experience',
  'rpg': 'experience',
  'stamps': 'experience',
  'leaderboard': 'experience',
  'museum-battle': 'experience',
  'skins': 'experience',
  'social-checkin': 'experience',
  'clues': 'experience',

  // Governance
  'analytics': 'governance',
  'audit': 'governance',
  'executive-reports': 'governance',
  'ppa': 'governance',
  'tenants': 'governance',
  'tenant-services': 'governance',
  'reports': 'governance',
  'ops': 'governance',
  'plans': 'governance',
  'secretary': 'governance',
  'roadmap-extra': 'governance',
  'roadmap-family': 'governance',

  // Trust & Safety
  'moderation': 'trust-safety',
  'reviews': 'trust-safety',
  'certificates': 'trust-safety',
  'certificate-rules': 'trust-safety',
  'certificate-templates': 'trust-safety',
};

// Replace all imports
for (const [filename, domain] of Object.entries(mapping)) {
  const regex = new RegExp(`"./routes/${filename}.js"`, 'g');
  content = content.replace(regex, `"./domains/${domain}/${filename}.js"`);
}

fs.writeFileSync(indexPath, content, 'utf-8');
console.log('index.ts imports updated successfully.');
