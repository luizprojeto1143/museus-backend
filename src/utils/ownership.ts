import { prisma } from "../prisma.js";
import { Role } from "@prisma/client";

export type CheckableEntity =
  | 'accessibilityExecution'
  | 'event'
  | 'work'
  | 'space'
  | 'theaterMember'
  | 'theaterCue'
  | 'qRCode'
  | 'workTranslation'
  | 'teacherProfile'
  | 'volunteer'
  | 'volunteerShift'
  | 'schoolVisit'
  | 'postVisitActivity'
  | 'intangibleHeritage'
  | 'pPAGoal'
  | 'badgeRequest'
  | 'category'
  | 'ticket'
  | 'coupon'
  | 'curatorNote'
  | 'trail'
  | 'achievement'
  | 'clue'
  | 'passportStamp'
  | 'certificateRule'
  | 'certificateTemplate'
  | 'review'
  | 'booking'
  | 'culturalProject'
  | 'file'
  | 'accountsReceivable'
  | 'accountsPayable'
  | 'chargeback';

export async function checkEntityOwnership(
  entityName: CheckableEntity,
  id: string,
  user: { id: string; role: Role; tenantId?: string | null }
): Promise<{ success: boolean; record?: any; status: number; message: string }> {
  if (!id) {
    return { success: false, status: 400, message: "ID é obrigatório" };
  }

  const dbModel = (prisma as any)[entityName];
  if (!dbModel) {
    return { success: false, status: 500, message: `Model ${entityName} não encontrado no Prisma` };
  }

  try {
    const record = await dbModel.findUnique({
      where: { id }
    });

    if (!record) {
      return { success: false, status: 404, message: "Registro não encontrado" };
    }

    if (user.role !== Role.MASTER) {
      if (entityName === 'theaterCue') {
        const event = await prisma.event.findUnique({ where: { id: record.eventId } });
        if (!event || event.tenantId !== user.tenantId) {
          return { success: false, status: 403, message: "Sem permissão (Isolamento de Tenant)" };
        }
      } else if (entityName === 'volunteerShift') {
        const volunteer = await prisma.volunteer.findUnique({ where: { id: record.volunteerId } });
        if (!volunteer || volunteer.tenantId !== user.tenantId) {
          return { success: false, status: 403, message: "Sem permissão (Isolamento de Tenant)" };
        }
      } else if (entityName === 'ticket') {
        const event = await prisma.event.findUnique({ where: { id: record.eventId } });
        if (!event || event.tenantId !== user.tenantId) {
          return { success: false, status: 403, message: "Sem permissão (Isolamento de Tenant)" };
        }
      } else if (entityName === 'passportStamp') {
        const work = await prisma.work.findUnique({ where: { id: record.workId } });
        if (!work || work.tenantId !== user.tenantId) {
          return { success: false, status: 403, message: "Sem permissão (Isolamento de Tenant)" };
        }
      } else if (entityName === 'review') {
        if (record.eventId) {
          const event = await prisma.event.findUnique({ where: { id: record.eventId } });
          if (!event || event.tenantId !== user.tenantId) {
            return { success: false, status: 403, message: "Sem permissão (Isolamento de Tenant)" };
          }
        } else if (record.workId) {
          const work = await prisma.work.findUnique({ where: { id: record.workId } });
          if (!work || work.tenantId !== user.tenantId) {
            return { success: false, status: 403, message: "Sem permissão (Isolamento de Tenant)" };
          }
        }
      } else if (record.tenantId !== user.tenantId) {
        return { success: false, status: 403, message: "Sem permissão (Isolamento de Tenant)" };
      }
    }

    return { success: true, record, status: 200, message: "OK" };
  } catch (error: any) {
    return { success: false, status: 500, message: `Erro ao buscar propriedade: ${error.message}` };
  }
}
