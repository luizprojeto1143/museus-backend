export function maskCPF(cpf: string): string {
  const clean = cpf.replace(/\D/g, "");
  if (clean.length !== 11) return cpf;
  return `${clean.substring(0, 3)}.***.***-${clean.substring(9)}`;
}

export function maskCNPJ(cnpj: string): string {
  const clean = cnpj.replace(/\D/g, "");
  if (clean.length !== 14) return cnpj;
  return `${clean.substring(0, 2)}.***.***/${clean.substring(8, 12)}-${clean.substring(12)}`;
}

export function sanitizeLogMetadata(data: any): any {
  if (!data) return data;

  if (Array.isArray(data)) {
    return data.map(item => sanitizeLogMetadata(item));
  }

  if (typeof data === "object") {
    const sanitized: any = {};
    const sensitiveKeys = [
      "password", "senha", "token", "accesstoken", "refreshtoken", 
      "authorization", "cookie", "secret", "card", "cvv", "cvc", 
      "jwt", "key", "pwd"
    ];

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();

      // Mask sensitive keys
      if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
        sanitized[key] = "[REDACTED]";
      } else if (lowerKey === "cpf" && typeof value === "string") {
        sanitized[key] = maskCPF(value);
      } else if (lowerKey === "cnpj" && typeof value === "string") {
        sanitized[key] = maskCNPJ(value);
      } else {
        sanitized[key] = sanitizeLogMetadata(value);
      }
    }
    return sanitized;
  }

  return data;
}
