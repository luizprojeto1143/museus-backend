import { PrismaClient, TriggerType, CertificateType } from '@prisma/client';
import { CertificateService } from './certificate.js';

const prisma = new PrismaClient();

export class CertificateEngine {

    /**
     * Evaluates rules for a specific trigger and context
     */
    static async evaluate(trigger: TriggerType, context: {
        tenantId: string;
        visitorId: string;
        trailId?: string;
        eventId?: string;
        newXp?: number;
    }) {
        console.log(`[CertificateEngine] Evaluating rules for ${trigger}`, context);

        // 1. Fetch active rules for this tenant and trigger
        const rules = await prisma.certificateRule.findMany({
            where: {
                tenantId: context.tenantId,
                triggerType: trigger,
                active: true
            },
            include: { actionTemplate: true }
        });

        if (rules.length === 0) return;

        // 2. Iterate and check conditions
        for (const rule of rules) {
            let matched = false;
            const conditions = rule.conditions as any; // e.g., { min_xp: 100, trail_id: "xyz" }

            switch (trigger) {
                case 'TRAIL_COMPLETED':
                    if (conditions.trail_id) {
                        matched = conditions.trail_id === context.trailId;
                    } else {
                        // If no specific trail is set, maybe it applies to ANY trail? 
                        // Let's assume for now it must match if provided, or true if empty (generic)
                        matched = true;
                    }
                    break;

                case 'EVENT_ATTENDED':
                    if (conditions.event_id) {
                        matched = conditions.event_id === context.eventId;
                    } else {
                        matched = true;
                    }
                    break;

                case 'XP_THRESHOLD':
                    if (conditions.min_xp && context.newXp) {
                        matched = context.newXp >= conditions.min_xp;
                    }
                    break;
            }

            if (matched) {
                await this.issueCertificate(rule, context);
            }
        }
    }

    /**
     * Issues the certificate based on a rule
     */
    private static async issueCertificate(rule: any, context: any) {
        // Check if already issued to avoid duplicates
        // We can check by unique code or by querying existing certificates for this visitor/rule/relatedId
        // Ideally we should add 'ruleId' or similar to metadata to track origin

        // Construct Metadata
        let type: CertificateType = 'CUSTOM';
        let relatedId = null;
        let title = rule.name;

        if (rule.triggerType === 'TRAIL_COMPLETED') {
            type = 'TRAIL';
            relatedId = context.trailId;
            // Fetch title?
        } else if (rule.triggerType === 'EVENT_ATTENDED') {
            type = 'EVENT';
            relatedId = context.eventId;
        }

        // Check duplicate policy: For now, one certificate per rule per visitor
        // We look at metadata to find if we already issued for this rule
        const existing = await prisma.certificate.findFirst({
            where: {
                visitorId: context.visitorId,
                metadata: {
                    path: ['ruleId'],
                    equals: rule.id
                }
            }
        });

        if (existing) {
            console.log(`[CertificateEngine] Certificate already issued for rule ${rule.id}`);
            return;
        }

        // Generate Code
        const code = CertificateService.generateCode();

        // Create
        const cert = await prisma.certificate.create({
            data: {
                code,
                visitorId: context.visitorId,
                tenantId: context.tenantId,
                type,
                relatedId,
                templateId: rule.actionTemplateId,
                metadata: {
                    ruleId: rule.id,
                    trigger: rule.triggerType,
                    title: title
                    // Add more context data if needed (e.g. trail title)
                }
            }
        });

        console.log(`[CertificateEngine] Issued certificate ${cert.code} for visitor ${context.visitorId}`);
    }
}
