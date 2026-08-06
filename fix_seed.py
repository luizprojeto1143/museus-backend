# -*- coding: utf-8 -*-
import os
import re

file_path = './prisma/seed.ts.bak'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the start of main
new_main_start = '''    console.log("🌱 Iniciando seed...");

    // 0. Ensure Master User exists first (independently of demo data)
    const email = "admin@museu.com";
    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (!existingUser) {
        console.log("👤 Criando Usuário Master (admin@museu.com)...");
        const hashedPassword = await bcrypt.hash(process.env.DEFAULT_PASSWORD || "Museu!", 10);

        await prisma.user.create({
            data: {
                email,
                name: "Admin Master",
                password: hashedPassword,
                role: Role.MASTER,
                tenantId: null // Global master, not tied to demo tenant
            }
        });
        console.log("🔑 Usuário Master criado!");
    } else {
        console.log("✓ Usuário Master já existe.");
    }

    if (process.env.FORCE_SEED_DEMO !== "true") {
        const tenantCount = await prisma.tenant.count();
        if (tenantCount > 0) {
            console.log("✓ Banco de dados já possui tenants. Pulando criação de dados de demonstração.");
            return;
        }
    }

    // 1. Criar Tenant Padrão (Museu Demo) se não existir'''

content = re.sub(r'    console\.log\("🌱 Iniciando seed\.\.\."\);\n\n    // 1\. Criar Tenant Padrão \(Museu Demo\) se não existir', new_main_start, content)

# Remove the old master user block completely
old_master_block_pattern = r'    // 2\. Criar Usuário Master se não existir.*?    } else \{\n        console\.log\("✓ Usuário Master já existe\."\);\n    \}'
content = re.sub(old_master_block_pattern, '    // 2. Usuário Master criado no inicio do script.', content, flags=re.DOTALL)

with open('./prisma/seed.ts', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
