
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("🕯️ Starting Relic Guardian...");
  const now = new Date();

  // 1. AUTO-EXPIRE: Find vestiges that should be RELICS now
  const toExpire = await prisma.work.findMany({
    where: {
      vestigeActive: true,
      vestigeExpiresAt: {
        lt: now
      }
    }
  });

  console.log(`⌛ Found ${toExpire.length} vestiges to expire.`);

  for (const work of toExpire) {
    console.log(`✨ Converting to RELIC: ${work.title} (${work.id})`);
    
    await prisma.$transaction([
      // Mark work as inactive
      prisma.work.update({
        where: { id: work.id },
        data: { vestigeActive: false }
      }),
      // Convert all existing stamps to RELIC
      prisma.passportStamp.updateMany({
        where: { workId: work.id },
        data: { 
          isRelic: true,
          raridade: "RELIC",
          convertidoEm: now
        }
      })
    ]);
  }

  // 2. URGENCY ALERTS: Notify about soon-to-expire vestiges
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const fortyEightHoursFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

  const soonExpiring = await prisma.work.findMany({
    where: {
      vestigeActive: true,
      vestigeExpiresAt: {
        gt: now,
        lt: sevenDaysFromNow
      }
    }
  });

  for (const work of soonExpiring) {
    const timeLeft = work.vestigeExpiresAt.getTime() - now.getTime();
    const isCritical = timeLeft < 2 * 24 * 60 * 60 * 1000;
    const type = isCritical ? 'CRITICAL' : 'WARNING';
    const message = isCritical 
      ? `ÚLTIMAS 48H: O vestígio "${work.title}" se tornará uma Relíquia em breve!` 
      : `ATENÇÃO: A exposição de "${work.title}" encerra em 7 dias!`;

    // Create alert if not already notified for this stage
    const link = `/vestiges/${work.id}`;
    const existingAlert = await prisma.vestigeAlert.findFirst({
      where: {
        link: link,
        tipo: type
      }
    });

    if (!existingAlert) {
      console.log(`🔔 Creating ${type} alert for: ${work.title}`);
      await prisma.vestigeAlert.create({
        data: {
          tenantId: work.tenantId,
          tipo: type,
          titulo: isCritical ? 'URGENTE: Expira em 48h' : 'AVISO: Expira em 7 dias',
          mensagem: message,
          link: link,
          expiresAt: work.vestigeExpiresAt
        }
      });
    }
  }

  console.log("✅ Guardian task completed.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
